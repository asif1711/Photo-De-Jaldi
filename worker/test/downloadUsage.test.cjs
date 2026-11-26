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
const s3 = require('../src/s3.ts');
const worker = require('../src/index.ts').default;

const USER = { id: 'user-id' };
const BUCKET_ID = '123e4567-e89b-12d3-a456-426614174000';
const FILE_ID = 'file-id';
const ENV = {};
const USAGE = {
  maximum_bytes: 1000,
  committed_bytes: 300,
  reserved_bytes: 100,
  available_bytes: 600,
  percent_used: 40,
  is_limit_reached: false,
};

function installMocks({
  file = {
    id: FILE_ID,
    bucket_id: BUCKET_ID,
    file_name: 'image.jpg',
    object_key: `buckets/${BUCKET_ID}/image.jpg`,
    mime_type: 'image/jpeg',
    file_size: 2048,
    upload_status: 'uploaded',
  },
  rpc,
} = {}) {
  const originals = {
    authenticateRequest: auth.authenticateRequest,
    getSupabaseAdmin: auth.getSupabaseAdmin,
    verifyBucketAccess: auth.verifyBucketAccess,
    generateDownloadPresignedUrl: s3.generateDownloadPresignedUrl,
    consoleError: console.error,
  };
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (rpc) return rpc(name, args);
      if (name === 'record_download_usage') return { data: null, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      assert.equal(table, 'bucket_files');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: file, error: null }; },
      };
    },
  };

  auth.authenticateRequest = async () => ({ user: USER, error: null });
  auth.getSupabaseAdmin = () => db;
  auth.verifyBucketAccess = async () => ({
    authorized: true,
    isOwner: true,
    bucket: { status: 'active', expires_at: new Date(Date.now() + 60_000).toISOString() },
    error: null,
  });
  s3.generateDownloadPresignedUrl = async () => 'https://b2.test/signed-file';
  console.error = () => {};

  return {
    calls,
    restore() {
      auth.authenticateRequest = originals.authenticateRequest;
      auth.getSupabaseAdmin = originals.getSupabaseAdmin;
      auth.verifyBucketAccess = originals.verifyBucketAccess;
      s3.generateDownloadPresignedUrl = originals.generateDownloadPresignedUrl;
      console.error = originals.consoleError;
    },
  };
}

async function authorizeDownload(fileId = FILE_ID) {
  const context = { pending: null, waitUntil(promise) { this.pending = promise; } };
  const response = await worker.fetch(
    new Request('https://worker.test/downloads/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    }),
    ENV,
    context
  );
  if (context.pending) await context.pending;
  return response;
}

test('download authorization records known size exactly once after signing', async (t) => {
  const mocks = installMocks();
  t.after(() => mocks.restore());

  const context = { pending: null, waitUntil(promise) { this.pending = promise; } };
  const response = await worker.fetch(
    new Request('https://worker.test/downloads/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: FILE_ID }),
    }),
    ENV,
    context
  );
  await context.pending;

  assert.equal(response.status, 200);
  assert.deepEqual(mocks.calls, [{
    name: 'record_download_usage',
    args: { p_bytes: 2048 },
  }]);
});

test('usage recording failure does not change the authorization response', async (t) => {
  const mocks = installMocks({
    rpc: async () => ({ data: null, error: { message: 'write unavailable' } }),
  });
  t.after(() => mocks.restore());

  const response = await authorizeDownload();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    downloadUrl: 'https://b2.test/signed-file',
    fileName: 'image.jpg',
    fileSize: 2048,
    mimeType: 'image/jpeg',
    expiresInSeconds: 300,
  });
});

test('external-key downloads with unknown size are not recorded', async (t) => {
  const mocks = installMocks({ file: null });
  t.after(() => mocks.restore());

  const response = await authorizeDownload(`buckets/${BUCKET_ID}/unknown.jpg`);
  assert.equal(response.status, 200);
  assert.equal(mocks.calls.length, 0);
});

test('storage usage keeps usage fields when either optional RPC fails', async (t) => {
  for (const failedRpc of ['get_file_status_breakdown', 'get_download_usage_today']) {
    await t.test(`${failedRpc} failure is non-fatal`, async (subtest) => {
      const mocks = installMocks({
        rpc: async (name) => {
          if (name === 'get_storage_usage') return { data: USAGE, error: null };
          if (name === failedRpc) {
            return { data: null, error: { message: 'optional aggregate unavailable' } };
          }
          if (name === 'get_file_status_breakdown') {
            return {
              data: [
                { file_status: 'uploaded', file_count: 1, total_bytes: 300 },
                { file_status: 'expired', file_count: 0, total_bytes: 0 },
                { file_status: 'deleted', file_count: 0, total_bytes: 0 },
              ],
              error: null,
            };
          }
          if (name === 'get_download_usage_today') return { data: 512, error: null };
          throw new Error(`Unexpected RPC: ${name}`);
        },
      });
      subtest.after(() => mocks.restore());

      const response = await worker.fetch(
        new Request('https://worker.test/storage/usage'),
        ENV
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.committed_bytes, USAGE.committed_bytes);
      assert.equal(body.available_bytes, USAGE.available_bytes);
      assert.deepEqual(
        body.file_status_breakdown,
        failedRpc === 'get_file_status_breakdown' ? [] : [
          { file_status: 'uploaded', file_count: 1, total_bytes: 300 },
          { file_status: 'expired', file_count: 0, total_bytes: 0 },
          { file_status: 'deleted', file_count: 0, total_bytes: 0 },
        ]
      );
      assert.equal(
        body.download_bytes_today,
        failedRpc === 'get_download_usage_today' ? null : 512
      );
    });
  }
});
