import { Env } from './types';
import { APP_LIMITS } from './caps';

const B2_NATIVE_API_BASE = 'https://api.backblazeb2.com/b2api/v4';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [250, 750, 1750];

export const MAX_B2_SUBREQUESTS_PER_INVOCATION = APP_LIMITS.CLEANUP_REQUEST_BUDGET;

export class CleanupBudgetExhaustedError extends Error {
  constructor() {
    super('Cleanup subrequest budget reserve reached');
    this.name = 'CleanupBudgetExhaustedError';
  }
}

export interface B2RequestBudget {
  consumeB2Request(): void;
}

interface B2StorageApi {
  apiUrl: string;
  allowed?: {
    buckets?: { id: string; name: string | null }[];
    capabilities?: string[];
  };
}

interface B2FileVersion {
  fileId: string;
  fileName: string;
  action: string;
}

interface B2UnfinishedFile {
  fileId: string;
  fileName: string;
}

export interface B2CleanupSession {
  apiUrl: string;
  authorizationToken: string;
  bucketId: string;
  requestBudget: B2RequestBudget;
}

export interface PrefixCleanupResult {
  discovered: number;
  deleted: number;
  hasMore: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiErrorCode(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return 'unknown';
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'unknown';
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  operation: string,
  requestBudget: B2RequestBudget
): Promise<Response> {
  let lastError = 'network_error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    requestBudget.consumeB2Request();
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        return response;
      }

      lastError = `http_${response.status}`;
      await response.body?.cancel();
    } catch {
      lastError = 'network_error';
    }

    if (attempt < MAX_RETRIES - 1) {
      console.warn('[b2-cleanup] Retrying transient API failure', {
        operation,
        attempt: attempt + 1,
        error: lastError,
      });
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error(`${operation} failed (${lastError})`);
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${operation} failed (invalid_json)`);
  }

  if (!response.ok) {
    throw new Error(`${operation} failed (${apiErrorCode(body)})`);
  }
  return body as T;
}

async function nativeApiRequest<T>(
  session: Pick<B2CleanupSession, 'apiUrl' | 'authorizationToken' | 'requestBudget'>,
  operation: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetchWithRetry(
    `${session.apiUrl}/b2api/v4/${operation}`,
    {
      method: 'POST',
      headers: {
        Authorization: session.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    operation,
    session.requestBudget
  );
  return readJson<T>(response, operation);
}

export async function authorizeB2Cleanup(
  env: Env,
  requestBudget: B2RequestBudget
): Promise<B2CleanupSession> {
  const authorization = await fetchWithRetry(
    `${B2_NATIVE_API_BASE}/b2_authorize_account`,
    {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`)}`,
      },
    },
    'b2_authorize_account',
    requestBudget
  );
  const authorized = await readJson<{
    apiInfo?: { storageApi?: B2StorageApi };
    authorizationToken?: string;
  }>(authorization, 'b2_authorize_account');
  const storageApi = authorized.apiInfo?.storageApi;
  const authorizationToken = authorized.authorizationToken;
  if (!storageApi?.apiUrl || !authorizationToken) {
    throw new Error('B2 authorization response is incomplete');
  }

  const capabilities = storageApi.allowed?.capabilities ?? [];
  if (
    !capabilities.includes('all') &&
    !['listFiles', 'deleteFiles', 'writeFiles'].every((capability) =>
      capabilities.includes(capability)
    )
  ) {
    throw new Error('B2 application key requires listFiles, deleteFiles, and writeFiles');
  }

  const allowedBucket = storageApi.allowed?.buckets?.find(
    (bucket) => bucket.name === env.B2_BUCKET_NAME
  );
  let bucketId = allowedBucket?.id;

  if (!bucketId) {
    if (!capabilities.includes('all') && !capabilities.includes('listBuckets')) {
      throw new Error('B2 application key requires listBuckets to resolve the storage bucket');
    }
    const bucketResult = await nativeApiRequest<{
      buckets?: { bucketId: string; bucketName: string }[];
    }>(
      {
        apiUrl: storageApi.apiUrl,
        authorizationToken,
        requestBudget,
      },
      'b2_list_buckets',
      { bucketName: env.B2_BUCKET_NAME }
    );
    bucketId = bucketResult.buckets?.find(
      (bucket) => bucket.bucketName === env.B2_BUCKET_NAME
    )?.bucketId;
  }

  if (!bucketId) {
    throw new Error('Configured B2 bucket could not be resolved');
  }

  return {
    apiUrl: storageApi.apiUrl,
    authorizationToken,
    bucketId,
    requestBudget,
  };
}

async function listFileVersions(
  session: B2CleanupSession,
  prefix: string,
  maxFileCount: number
): Promise<B2FileVersion[]> {
  const result = await nativeApiRequest<{ files?: B2FileVersion[] }>(
    session,
    'b2_list_file_versions',
    { bucketId: session.bucketId, prefix, maxFileCount }
  );
  if (!Array.isArray(result.files)) {
    throw new Error('b2_list_file_versions failed (invalid_response)');
  }
  return result.files;
}

async function listUnfinishedFiles(
  session: B2CleanupSession,
  namePrefix: string,
  maxFileCount: number
): Promise<B2UnfinishedFile[]> {
  const result = await nativeApiRequest<{ files?: B2UnfinishedFile[] }>(
    session,
    'b2_list_unfinished_large_files',
    { bucketId: session.bucketId, namePrefix, maxFileCount }
  );
  if (!Array.isArray(result.files)) {
    throw new Error('b2_list_unfinished_large_files failed (invalid_response)');
  }
  return result.files;
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
): Promise<void> {
  for (let start = 0; start < items.length; start += concurrency) {
    await Promise.all(items.slice(start, start + concurrency).map(operation));
  }
}

export async function deleteObjectVersionsForPrefix(
  session: B2CleanupSession,
  prefix: string,
  maxDeletes: number
): Promise<PrefixCleanupResult> {
  let discovered = 0;
  let deleted = 0;

  if (maxDeletes <= 0) {
    return { discovered, deleted, hasMore: true };
  }

  while (deleted < maxDeletes) {
    const requestedCount = Math.min(100, maxDeletes - deleted);
    const page = await listFileVersions(session, prefix, requestedCount);
    if (page.length === 0) {
      return { discovered, deleted, hasMore: false };
    }

    if (page.some((file) => !file.fileId || !file.fileName.startsWith(prefix))) {
      throw new Error('B2 version listing returned an object outside the bucket prefix');
    }

    discovered += page.length;
    await runConcurrent(page, 10, async (file) => {
      await nativeApiRequest(session, 'b2_delete_file_version', {
        fileName: file.fileName,
        fileId: file.fileId,
      });
    });
    deleted += page.length;
    if (page.length < requestedCount) {
      return { discovered, deleted, hasMore: false };
    }
  }

  return { discovered, deleted, hasMore: true };
}

export async function abortUnfinishedFilesForPrefix(
  session: B2CleanupSession,
  prefix: string,
  maxAborts: number
): Promise<PrefixCleanupResult> {
  let discovered = 0;
  let deleted = 0;

  if (maxAborts <= 0) {
    return { discovered, deleted, hasMore: true };
  }

  while (deleted < maxAborts) {
    const requestedCount = Math.min(100, maxAborts - deleted);
    const page = await listUnfinishedFiles(session, prefix, requestedCount);
    if (page.length === 0) {
      return { discovered, deleted, hasMore: false };
    }

    if (page.some((file) => !file.fileId || !file.fileName.startsWith(prefix))) {
      throw new Error('B2 unfinished-upload listing returned an object outside the bucket prefix');
    }

    discovered += page.length;
    await runConcurrent(page, 10, async (file) => {
      await nativeApiRequest(session, 'b2_cancel_large_file', { fileId: file.fileId });
    });
    deleted += page.length;
    if (page.length < requestedCount) {
      return { discovered, deleted, hasMore: false };
    }
  }

  return { discovered, deleted, hasMore: true };
}

export async function verifyPrefixEmpty(
  session: B2CleanupSession,
  prefix: string
): Promise<{ versions: number; unfinishedUploads: number }> {
  const [versions, unfinishedUploads] = await Promise.all([
    listFileVersions(session, prefix, 1),
    listUnfinishedFiles(session, prefix, 1),
  ]);
  return { versions: versions.length, unfinishedUploads: unfinishedUploads.length };
}
