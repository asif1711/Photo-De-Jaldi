/**
 * Bucket Management Service
 *
 * Interacts with Supabase PostgreSQL tables `buckets` and `bucket_members`.
 * Enforces Row Level Security (RLS) rules on the database level.
 *
 * Expiry classification policy:
 * Scheduled database status updates by Cloudflare Workers cron will be added in Stage 3.
 * In this stage, buckets whose `expires_at` has elapsed are classified dynamically
 * as 'expired' by the application so that they never remain in Active Buckets.
 */

import { supabase, isSupabaseConfigured } from '@/services/supabase';
import { Bucket, BucketStatus, CreateBucketInput, UpdateBucketInput } from '@/types';

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Computes the real-time effective status of a bucket.
 * If status is not terminal ('completed' or 'deleting') and expires_at is in the past,
 * it is classified as 'expired'.
 */
export function getEffectiveBucketStatus(bucket: Pick<Bucket, 'status' | 'expires_at'>): BucketStatus {
  if (bucket.status === 'completed' || bucket.status === 'deleting') {
    return bucket.status;
  }
  if (new Date(bucket.expires_at).getTime() <= Date.now()) {
    return 'expired';
  }
  return bucket.status;
}

/**
 * Returns true if the expiry timestamp has passed.
 */
export function isBucketExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * Creates a new bucket owned by the currently authenticated user.
 */
export async function createBucket(input: CreateBucketInput): Promise<ServiceResult<Bucket>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured in .env' };
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { data: null, error: 'You must be signed in to create a bucket.' };
    }

    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { data: null, error: 'Bucket name cannot be empty.' };
    }

    const expiryTime = new Date(input.expires_at).getTime();
    if (isNaN(expiryTime) || expiryTime <= Date.now()) {
      return { data: null, error: 'Expiry date must be in the future.' };
    }

    const { data, error } = await supabase
      .from('buckets')
      .insert({
        name: trimmedName,
        description: input.description?.trim() || null,
        created_by: user.id,
        expires_at: new Date(expiryTime).toISOString(),
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data as Bucket, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'An unexpected error occurred while creating bucket.' };
  }
}

/**
 * Fetches active buckets accessible to the current user.
 * Strictly excludes any bucket whose expires_at has passed.
 */
export async function getActiveBuckets(): Promise<ServiceResult<Bucket[]>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured in .env' };
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('buckets')
      .select('*')
      .eq('status', 'active')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    // Additional client-side guard against clock drift
    const nowMs = Date.now();
    const activeBuckets = ((data as Bucket[]) || []).filter(
      (b) => b.status === 'active' && new Date(b.expires_at).getTime() > nowMs
    );

    return { data: activeBuckets, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to fetch active buckets.' };
  }
}

/**
 * Fetches completed or expired buckets accessible to the current user.
 * Includes any bucket where status is 'completed'/'expired' OR expires_at is in the past.
 */
export async function getHistoryBuckets(): Promise<ServiceResult<Bucket[]>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured in .env' };
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('buckets')
      .select('*')
      .or(`status.in.(completed,expired),expires_at.lte.${nowIso}`)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    // Map each bucket to its effective status
    const historyBuckets = ((data as Bucket[]) || []).map((b) => ({
      ...b,
      status: getEffectiveBucketStatus(b),
    }));

    return { data: historyBuckets, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to fetch bucket history.' };
  }
}

/**
 * Fetches a single bucket by ID, computing its effective status.
 */
export async function getBucketById(bucketId: string): Promise<ServiceResult<Bucket>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured in .env' };
  }

  try {
    const { data, error } = await supabase
      .from('buckets')
      .select('*')
      .eq('id', bucketId)
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    const rawBucket = data as Bucket;
    const bucketWithEffectiveStatus: Bucket = {
      ...rawBucket,
      status: getEffectiveBucketStatus(rawBucket),
    };

    return { data: bucketWithEffectiveStatus, error: null };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to load bucket.' };
  }
}

/**
 * Updates bucket metadata. Only permitted for bucket owners under RLS.
 */
export async function updateBucket(
  bucketId: string,
  updates: UpdateBucketInput
): Promise<ServiceResult<Bucket>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured in .env' };
  }

  try {
    const payload: Record<string, any> = {};

    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (!trimmedName) {
        return { data: null, error: 'Bucket name cannot be empty.' };
      }
      payload.name = trimmedName;
    }

    if (updates.description !== undefined) {
      payload.description = updates.description ? updates.description.trim() : null;
    }

    if (updates.expires_at !== undefined) {
      const expiryTime = new Date(updates.expires_at).getTime();
      if (isNaN(expiryTime) || expiryTime <= Date.now()) {
        return { data: null, error: 'Expiry date must be in the future.' };
      }
      payload.expires_at = new Date(expiryTime).toISOString();
    }

    if (updates.status !== undefined) {
      payload.status = updates.status;
    }

    const { data, error } = await supabase
      .from('buckets')
      .update(payload)
      .eq('id', bucketId)
      .select()
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    const rawBucket = data as Bucket;
    return {
      data: {
        ...rawBucket,
        status: getEffectiveBucketStatus(rawBucket),
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err?.message || 'Failed to update bucket.' };
  }
}

/**
 * Deletes a bucket by ID. Only permitted for bucket owners under RLS.
 */
export async function deleteBucket(bucketId: string): Promise<{ success: boolean; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured in .env' };
  }

  try {
    const { error } = await supabase.from('buckets').delete().eq('id', bucketId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete bucket.' };
  }
}
