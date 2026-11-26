// This file is mirrored in worker/src/caps.ts. Keep both copies in sync.
export const BACKBLAZE_B2_FREE_CAPS = {
  STORAGE_BYTES: 10_000_000_000, // Source: Backblaze B2 account free-tier storage cap (10 GB).
  DOWNLOAD_BANDWIDTH_BYTES_PER_DAY: 1_000_000_000, // Source: Backblaze B2 account free-tier daily bandwidth cap (1 GB).
  CLASS_B_TRANSACTIONS_PER_DAY: 2_500, // Source: Backblaze B2 account free-tier daily Class B cap.
  CLASS_C_TRANSACTIONS_PER_DAY: 2_500, // Source: Backblaze B2 account free-tier daily Class C cap.
  CLASS_A_DELETES_AND_CANCEL_LARGE_FILE_FREE_AND_UNCAPPED: true, // Source: Backblaze B2 account free-tier Class A delete/cancel policy.
} as const;

export const CLOUDFLARE_WORKERS_FREE_CAPS = {
  REQUESTS_PER_DAY: 100_000, // Source: Cloudflare Workers Free plan request cap.
  SUBREQUESTS_PER_INVOCATION: 50, // Source: Cloudflare Workers Free plan subrequest cap.
  CPU_MILLISECONDS_PER_REQUEST: 10, // Source: Cloudflare Workers Free plan CPU limit per request.
  CPU_MILLISECONDS_PER_CRON_TRIGGER: 10, // Source: Cloudflare Workers Free plan CPU limit per Cron Trigger.
  CRON_TRIGGERS_PER_ACCOUNT: 5, // Source: Cloudflare Workers Free plan Cron Trigger cap.
} as const;

export const WEB_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// Verify Cloudflare's separate "internal services" subrequest limit in their docs before relying on it.
export const APP_LIMITS = {
  TOTAL_STORAGE_BYTES: 9_000_000_000, // Source: public.global_storage_usage.maximum_bytes in the quota migration (decimal bytes).
  STORAGE_WARNING_THRESHOLD: 0.9, // Source: AppConfig warning thresholds and the Storage tab requirement.
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024, // Source: existing Worker and bulk upload per-file cap.
  MAX_CONCURRENT_UPLOADS: 2, // Source: existing bulk upload queue concurrency.
  MAX_PART_RETRIES: 3, // Source: existing bulk upload part retry limit.
  MAX_FILES_PER_DELETE_ACTION: 50, // Source: existing owner file deletion limit.
  FILE_DELETE_CONCURRENCY: 5, // Source: existing owner file deletion concurrency.
  CLEANUP_REQUEST_BUDGET: 40, // Source: existing expiry-cleanup per-invocation budget.
  CLEANUP_FINAL_CALL_RESERVE: 2, // Source: existing expiry-cleanup finalization reserve.
  CLEANUP_CRON_INTERVAL_MINUTES: 15, // Source: existing Wrangler scheduled Cron interval.
  CLEANUP_LEASE_SECONDS: 900, // Source: existing expiry-cleanup lease.
  CLEANUP_RETRY_DELAY_SECONDS: 300, // Source: existing expiry-cleanup retry delay.
  CLEANUP_EMPTY_PREFIX_QUIET_PERIOD_MS: 15 * 60 * 1000, // Source: existing expiry-cleanup quiet period.
} as const;
