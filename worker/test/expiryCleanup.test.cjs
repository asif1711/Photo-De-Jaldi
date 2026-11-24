const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, filename);
};

const auth = require('../src/auth.ts');
const { runExpiredBucketCleanup } = require('../src/expiryCleanup.ts');

const BUCKET_ID = '123e4567-e89b-12d3-a456-426614174000';
const PREFIX = `buckets/${BUCKET_ID}/`;
const ENV = {
  B2_BUCKET_NAME: 'cleanup-test',
  B2_KEY_ID: 'test-key-id',
  B2_APPLICATION_KEY: 'test-application-key',
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('expiry cleanup stays within budget and resumes until storage is empty', async (t) => {
  const outsideVersion = {
    fileId: 'other-bucket-version',
    fileName: 'buckets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/keep.jpg',
    action: 'upload',
  };
  const allVersions = [
    ...Array.from({ length: 500 }, (_, index) => ({
      fileId: `version-${index}`,
      fileName: `${PREFIX}file-${index}.jpg`,
      action: 'upload',
    })),
    outsideVersion,
  ];
  const unfinishedUploads = Array.from({ length: 17 }, (_, index) => ({
    fileId: `unfinished-${index}`,
    fileName: `${PREFIX}large-${index}.mp4`,
  }));
  const deletedKeys = [];
  const deletedIds = [];
  const remainingTargetVersions = () =>
    allVersions.filter((file) => file.fileName.startsWith(PREFIX)).length;
  const db = {
    status: 'deleting',
    cleanupVerifiedAt: null,
    leaseToken: null,
    attempts: 0,
    currentRun: null,
    versionListCalls: 0,
    unfinishedListCalls: 0,
    async rpc(name, args) {
      await fetch(`https://supabase.test/rpc/${name}`, { method: 'POST' });
      this.currentRun.rpcNames.push(name);

      switch (name) {
        case 'mark_expired_buckets_for_cleanup':
          return { data: [], error: null };
        case 'claim_expired_buckets_for_cleanup':
          this.attempts += 1;
          this.leaseToken = `lease-${this.attempts}`;
          return {
            data: [{
              bucket_id: BUCKET_ID,
              cleanup_attempts: this.attempts,
              lease_token: this.leaseToken,
            }],
            error: null,
          };
        case 'retry_expired_bucket_cleanup':
          if (args.p_reset_verification) this.cleanupVerifiedAt = null;
          this.leaseToken = null;
          return { data: true, error: null };
        case 'record_expired_bucket_cleanup_verification':
          this.cleanupVerifiedAt = new Date(Date.now()).toISOString();
          this.leaseToken = null;
          return { data: true, error: null };
        case 'complete_expired_bucket_cleanup':
          this.status = 'expired';
          this.leaseToken = null;
          return { data: { success: true }, error: null };
        default:
          throw new Error(`Unexpected Supabase RPC: ${name}`);
      }
    },
    from(table) {
      assert.equal(table, 'buckets');
      const query = {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          await fetch('https://supabase.test/rest/v1/buckets?id=eq.test');
          db.currentRun.rpcNames.push('query:buckets');
          return {
            data: {
              id: BUCKET_ID,
              status: db.status,
              expires_at: new Date(Date.now() - 60_000).toISOString(),
              cleanup_lease_token: db.leaseToken,
              cleanup_verified_at: db.cleanupVerifiedAt,
            },
            error: null,
          };
        },
      };
      return query;
    },
  };

  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalGetSupabaseAdmin = auth.getSupabaseAdmin;
  const originalConsole = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  let clock = Date.UTC(2026, 10, 25, 0, 0, 0);
  let callsThisRun = 0;
  let runCount = 0;
  let callCounts = [];
  let listCounts = [];

  auth.getSupabaseAdmin = () => db;
  Date.now = () => clock;
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  global.fetch = async (input, init = {}) => {
    callsThisRun += 1;
    if (callsThisRun >= 51) {
      throw new Error('Mock rejected the 51st outbound request in this invocation');
    }

    const url = new URL(String(input));
    if (url.hostname === 'supabase.test') {
      return new Response(null, { status: 204 });
    }

    const operation = url.pathname.split('/').pop();
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (operation === 'b2_authorize_account') {
      return jsonResponse({
        apiInfo: {
          storageApi: {
            apiUrl: 'https://b2.test',
            allowed: {
              buckets: [{ id: 'b2-bucket-id', name: ENV.B2_BUCKET_NAME }],
              capabilities: ['listFiles', 'deleteFiles', 'writeFiles'],
            },
          },
        },
        authorizationToken: 'test-b2-token',
      });
    }

    if (url.hostname !== 'b2.test') {
      throw new Error(`Unexpected outbound host: ${url.hostname}`);
    }

    switch (operation) {
      case 'b2_list_unfinished_large_files':
        db.currentRun.b2ListCalls += 1;
        db.unfinishedListCalls += 1;
        return jsonResponse({
          files: unfinishedUploads
            .filter((file) => file.fileName.startsWith(body.namePrefix))
            .slice(0, body.maxFileCount),
        });
      case 'b2_cancel_large_file': {
        const index = unfinishedUploads.findIndex((file) => file.fileId === body.fileId);
        assert.notEqual(index, -1, 'unfinished upload is aborted only once');
        const [file] = unfinishedUploads.splice(index, 1);
        assert.ok(file.fileName.startsWith(PREFIX), 'aborted upload belongs to the target prefix');
        deletedKeys.push(file.fileName);
        deletedIds.push(file.fileId);
        return jsonResponse({ fileId: file.fileId });
      }
      case 'b2_list_file_versions':
        db.currentRun.b2ListCalls += 1;
        db.versionListCalls += 1;
        return jsonResponse({
          files: allVersions
            .filter((file) => file.fileName.startsWith(body.prefix))
            .slice(0, body.maxFileCount),
        });
      case 'b2_delete_file_version': {
        assert.ok(body.fileName.startsWith(PREFIX), 'deleted object belongs to the target prefix');
        const index = allVersions.findIndex((file) => file.fileId === body.fileId);
        assert.notEqual(index, -1, 'object version is deleted only once');
        allVersions.splice(index, 1);
        deletedKeys.push(body.fileName);
        deletedIds.push(body.fileId);
        return jsonResponse({ fileName: body.fileName, fileId: body.fileId });
      }
      default:
        throw new Error(`Unexpected B2 API operation: ${operation}`);
    }
  };

  try {
    while (db.status !== 'expired' && runCount < 100) {
      const versionsBefore = remainingTargetVersions();
      const unfinishedBefore = unfinishedUploads.length;
      const statusBefore = db.status;
      const verificationBefore = db.cleanupVerifiedAt;

      callsThisRun = 0;
      db.currentRun = { rpcNames: [], b2ListCalls: 0 };
      await runExpiredBucketCleanup(ENV);
      runCount += 1;
      callCounts.push(callsThisRun);
      listCounts.push(db.currentRun.b2ListCalls);

      assert.ok(callsThisRun <= 40, `run ${runCount} used ${callsThisRun} outbound requests`);
      assert.ok(
        db.currentRun.rpcNames.some((name) =>
          ['retry_expired_bucket_cleanup', 'record_expired_bucket_cleanup_verification',
            'complete_expired_bucket_cleanup'].includes(name)
        ),
        `run ${runCount} made a final lease/verification RPC`
      );
      if (runCount === 1) {
        assert.ok(remainingTargetVersions() < versionsBefore, 'first run deletes file versions');
        assert.ok(unfinishedUploads.length < unfinishedBefore, 'first run aborts unfinished uploads');
      }

      if (remainingTargetVersions() + unfinishedUploads.length > 0) {
        assert.ok(
          remainingTargetVersions() < versionsBefore ||
            unfinishedUploads.length < unfinishedBefore,
          `run ${runCount} made storage cleanup progress`
        );
      } else {
        assert.ok(
          db.status !== statusBefore || db.cleanupVerifiedAt !== verificationBefore,
          `run ${runCount} advanced verification or completion`
        );
      }

      if (remainingTargetVersions() + unfinishedUploads.length > 0) {
        assert.ok(
          db.currentRun.rpcNames.includes('retry_expired_bucket_cleanup'),
          `run ${runCount} released the cleanup lease for remaining work`
        );
      }
      clock += 15 * 60 * 1000;
    }
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    auth.getSupabaseAdmin = originalGetSupabaseAdmin;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.ok(runCount > 1, 'large bucket cleanup spans multiple scheduled runs');
  assert.equal(db.status, 'expired', 'bucket reaches the expired cleanup state');
  assert.equal(
    allVersions.filter((file) => file.fileName.startsWith(PREFIX)).length,
    0,
    'all target file versions are deleted'
  );
  assert.ok(allVersions.includes(outsideVersion), 'other bucket file version remains untouched');
  assert.equal(unfinishedUploads.length, 0, 'all target unfinished uploads are aborted');
  assert.ok(deletedKeys.every((key) => key.startsWith(PREFIX)));
  assert.ok(deletedIds.every((id) => id !== outsideVersion.fileId));
  assert.ok(callCounts.every((count) => count <= 40));
  assert.equal(Math.max(...listCounts), 4, 'final verification uses two additional B2 list calls');
  assert.ok(db.versionListCalls > 1, 'version listing resumes across runs');
  assert.ok(db.unfinishedListCalls > 1, 'unfinished-upload listing resumes across runs');
  t.diagnostic(
    `completed in ${runCount} runs; B2 list calls=${listCounts.reduce((total, count) => total + count, 0)}; max outbound requests/run=${Math.max(...callCounts)}`
  );
});
