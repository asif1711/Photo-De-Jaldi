import {
  abortUnfinishedFilesForPrefix,
  authorizeB2Cleanup,
  CleanupBudgetExhaustedError,
  deleteObjectVersionsForPrefix,
  MAX_B2_SUBREQUESTS_PER_INVOCATION,
  verifyPrefixEmpty,
  type B2RequestBudget,
} from './b2-cleanup';
import { getSupabaseAdmin } from './auth';
import { APP_LIMITS } from './caps';
import { Env } from './types';

const EXPIRY_DETECTION_BATCH_SIZE = 50;
const CLEANUP_BATCH_SIZE = 1;
const CLEANUP_LEASE_SECONDS = APP_LIMITS.CLEANUP_LEASE_SECONDS;
const MAX_SUBREQUESTS_PER_INVOCATION = APP_LIMITS.CLEANUP_REQUEST_BUDGET;
const FINAL_RPC_RESERVE = APP_LIMITS.CLEANUP_FINAL_CALL_RESERVE;
const RETRY_DELAY_SECONDS = APP_LIMITS.CLEANUP_RETRY_DELAY_SECONDS;
const EMPTY_PREFIX_QUIET_PERIOD_MS = APP_LIMITS.CLEANUP_EMPTY_PREFIX_QUIET_PERIOD_MS;
const BUCKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class CleanupInvocationBudget implements B2RequestBudget {
  private used = 0;

  get remainingWorkRequests(): number {
    return Math.max(0, MAX_SUBREQUESTS_PER_INVOCATION - FINAL_RPC_RESERVE - this.used);
  }

  consumeWorkRequest(): void {
    if (this.used >= MAX_SUBREQUESTS_PER_INVOCATION - FINAL_RPC_RESERVE) {
      throw new CleanupBudgetExhaustedError();
    }
    this.used += 1;
  }

  consumeFinalRequest(): void {
    if (this.used >= MAX_SUBREQUESTS_PER_INVOCATION) {
      throw new CleanupBudgetExhaustedError();
    }
    this.used += 1;
  }

  consumeB2Request(): void {
    this.consumeWorkRequest();
  }
}

interface ClaimedBucket {
  bucket_id: string;
  cleanup_attempts: number;
  lease_token: string;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return 'Unknown storage cleanup error';
}

async function retryCleanup(
  supabase: any,
  bucket: ClaimedBucket,
  budget: CleanupInvocationBudget,
  reason: string | null,
  resetVerification = false
): Promise<void> {
  let lastError = 'Retry RPC returned no confirmation';
  for (let attempt = 0; attempt < FINAL_RPC_RESERVE; attempt += 1) {
    budget.consumeFinalRequest();
    try {
      const { data, error } = await supabase.rpc('retry_expired_bucket_cleanup', {
        p_bucket_id: bucket.bucket_id,
        p_lease_token: bucket.lease_token,
        p_error: reason?.slice(0, 500) ?? null,
        p_retry_after_seconds: RETRY_DELAY_SECONDS,
        p_reset_verification: resetVerification,
      });

      if (!error) {
        if (data !== true) {
          console.warn('[expiry-cleanup] Retry lease was no longer current', {
            bucketId: bucket.bucket_id,
            attempt: bucket.cleanup_attempts,
          });
        }
        return;
      }
      lastError = error.message;
    } catch (error) {
      lastError = safeErrorMessage(error);
    }

    console.warn('[expiry-cleanup] Retry scheduling attempt failed', {
      bucketId: bucket.bucket_id,
      attempt: bucket.cleanup_attempts,
      retry: attempt + 1,
      error: lastError,
    });
  }

  console.error('[expiry-cleanup] Could not schedule retry', {
    bucketId: bucket.bucket_id,
    attempt: bucket.cleanup_attempts,
    error: lastError,
  });
}

async function cleanupBucket(
  supabase: any,
  session: Awaited<ReturnType<typeof authorizeB2Cleanup>>,
  bucket: ClaimedBucket,
  budget: CleanupInvocationBudget
): Promise<void> {
  if (!BUCKET_ID_PATTERN.test(bucket.bucket_id)) {
    throw new Error('Claimed bucket id is not a UUID');
  }

  budget.consumeWorkRequest();
  const { data: record, error: bucketError } = await supabase
    .from('buckets')
    .select('id,status,expires_at,cleanup_lease_token,cleanup_verified_at')
    .eq('id', bucket.bucket_id)
    .maybeSingle();

  if (bucketError) {
    throw new Error('Could not validate claimed bucket metadata');
  }
  if (
    !record ||
    record.status !== 'deleting' ||
    record.cleanup_lease_token !== bucket.lease_token ||
    new Date(record.expires_at).getTime() > Date.now()
  ) {
    throw new Error('Claimed bucket is no longer eligible for expiry cleanup');
  }

  const prefix = `buckets/${record.id}/`;
  console.info('[expiry-cleanup] Cleanup started', {
    bucketId: record.id,
    attempt: bucket.cleanup_attempts,
  });

  const abortLimit = Math.max(0, Math.floor((budget.remainingWorkRequests - 5) / 2));
  const multipart = await abortUnfinishedFilesForPrefix(session, prefix, abortLimit);
  console.info('[expiry-cleanup] Unfinished multipart uploads processed', {
    bucketId: record.id,
    discovered: multipart.discovered,
    aborted: multipart.deleted,
  });

  const versionLimit = Math.max(0, budget.remainingWorkRequests - 3);
  const versions = await deleteObjectVersionsForPrefix(session, prefix, versionLimit);
  console.info('[expiry-cleanup] Object versions processed', {
    bucketId: record.id,
    discovered: versions.discovered,
    deleted: versions.deleted,
  });

  if (multipart.hasMore || versions.hasMore) {
    console.info('[expiry-cleanup] More storage items remain; cleanup will continue', {
      bucketId: record.id,
    });
    await retryCleanup(supabase, bucket, budget, null, true);
    return;
  }

  const verification = await verifyPrefixEmpty(session, prefix);
  console.info('[expiry-cleanup] Storage verification completed', {
    bucketId: record.id,
    remainingVersions: verification.versions,
    remainingMultipartUploads: verification.unfinishedUploads,
  });
  if (verification.versions > 0 || verification.unfinishedUploads > 0) {
    await retryCleanup(
      supabase,
      bucket,
      budget,
      'B2 prefix was not empty after deletion',
      true
    );
    return;
  }

  const verifiedAt = record.cleanup_verified_at
    ? new Date(record.cleanup_verified_at).getTime()
    : null;
  const quietPeriodElapsed =
    verifiedAt !== null && Date.now() - verifiedAt >= EMPTY_PREFIX_QUIET_PERIOD_MS;

  if (multipart.deleted > 0 || versions.deleted > 0 || !quietPeriodElapsed) {
    budget.consumeFinalRequest();
    const { data: verificationRecorded, error: verificationError } = await supabase.rpc(
      'record_expired_bucket_cleanup_verification',
      {
        p_bucket_id: bucket.bucket_id,
        p_lease_token: bucket.lease_token,
        p_retry_after_seconds: RETRY_DELAY_SECONDS * 3,
      }
    );
    if (verificationError) {
      throw new Error('Empty B2 prefix could not be recorded for final verification');
    }
    if (verificationRecorded !== true) {
      throw new Error('Cleanup lease expired before verification could be recorded');
    }
    console.info('[expiry-cleanup] Empty prefix recorded; waiting for quiet-period verification', {
      bucketId: record.id,
    });
    return;
  }

  budget.consumeFinalRequest();
  const { error: completeError } = await supabase.rpc(
    'complete_expired_bucket_cleanup',
    {
      p_bucket_id: bucket.bucket_id,
      p_lease_token: bucket.lease_token,
    }
  );
  if (completeError) {
    throw new Error('B2 storage is empty, but cleanup state could not be finalized');
  }

  console.info('[expiry-cleanup] Cleanup succeeded', { bucketId: record.id });
}

export async function runExpiredBucketCleanup(env: Env): Promise<void> {
  if (MAX_SUBREQUESTS_PER_INVOCATION !== MAX_B2_SUBREQUESTS_PER_INVOCATION) {
    throw new Error('Expiry and B2 cleanup subrequest budgets must match');
  }

  const budget = new CleanupInvocationBudget();
  const supabase = getSupabaseAdmin(env);

  budget.consumeWorkRequest();
  const { data: markedBuckets, error: markError } = await supabase.rpc(
    'mark_expired_buckets_for_cleanup',
    { p_limit: EXPIRY_DETECTION_BATCH_SIZE }
  );
  if (markError) {
    console.error('[expiry-cleanup] Expiry detection failed', {
      error: markError.message,
    });
    return;
  }

  for (const bucket of markedBuckets ?? []) {
    console.info('[expiry-cleanup] Expired bucket marked for cleanup', {
      bucketId: bucket.bucket_id,
      cleanupAfter: bucket.cleanup_after,
    });
  }

  budget.consumeWorkRequest();
  const { data: claimedBuckets, error: claimError } = await supabase.rpc(
    'claim_expired_buckets_for_cleanup',
    {
      p_limit: CLEANUP_BATCH_SIZE,
      p_lease_seconds: CLEANUP_LEASE_SECONDS,
    }
  );
  if (claimError) {
    console.error('[expiry-cleanup] Could not claim expired buckets', {
      error: claimError.message,
    });
    return;
  }

  const buckets = (claimedBuckets ?? []) as ClaimedBucket[];
  if (buckets.length === 0) return;

  let session: Awaited<ReturnType<typeof authorizeB2Cleanup>>;
  try {
    session = await authorizeB2Cleanup(env, budget);
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error('[expiry-cleanup] Backblaze authorization failed', {
      bucketCount: buckets.length,
      error: message,
    });
    for (const bucket of buckets) await retryCleanup(supabase, bucket, budget, message);
    return;
  }

  for (const bucket of buckets) {
    try {
      await cleanupBucket(supabase, session, bucket, budget);
    } catch (error) {
      const message = safeErrorMessage(error);
      console.error('[expiry-cleanup] Cleanup failed; retry scheduled', {
        bucketId: bucket.bucket_id,
        attempt: bucket.cleanup_attempts,
        error: message,
      });
      await retryCleanup(supabase, bucket, budget, message);
    }
  }
}
