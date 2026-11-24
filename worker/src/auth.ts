import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthenticatedUser, Env } from './types';

export interface BucketAvailability {
  status: string;
  expires_at: string;
}

export function getBucketAvailabilityError(
  bucket: BucketAvailability
): { message: string; status: number } | null {
  if (bucket.status === 'expired' || bucket.status === 'deleting') {
    return { message: 'This bucket is no longer available.', status: 410 };
  }

  const expiresAt = new Date(bucket.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { message: 'This bucket has expired.', status: 410 };
  }

  // Completed buckets remain readable until expiry in the existing history model.
  if (bucket.status === 'active' || bucket.status === 'completed') {
    return null;
  }

  return { message: 'This bucket is not available.', status: 409 };
}

export function getSupabaseAdmin(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Validates Supabase JWT from Authorization header and extracts user profile.
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ user: AuthenticatedUser | null; error: string | null }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or malformed Authorization header.' };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return { user: null, error: 'Empty bearer token.' };
  }

  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { user: null, error: error?.message || 'Invalid or expired authorization token.' };
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.role,
    },
    error: null,
  };
}

/**
 * Verifies that the authenticated user owns or is an authorized member of the specified bucket.
 */
export async function verifyBucketAccess(
  supabase: SupabaseClient,
  bucketId: string,
  userId: string,
  requireOwner = false
): Promise<{ authorized: boolean; isOwner: boolean; bucket: any | null; error: string | null }> {
  // Query bucket metadata
  const { data: bucket, error: bucketError } = await supabase
    .from('buckets')
    .select('*')
    .eq('id', bucketId)
    .single();

  if (bucketError || !bucket) {
    return { authorized: false, isOwner: false, bucket: null, error: 'Bucket not found.' };
  }

  const isOwner = bucket.created_by === userId;

  if (requireOwner) {
    if (!isOwner) {
      return { authorized: false, isOwner: false, bucket, error: 'Only the bucket owner is authorized for this operation.' };
    }
    return { authorized: true, isOwner: true, bucket, error: null };
  }

  if (isOwner) {
    return { authorized: true, isOwner: true, bucket, error: null };
  }

  // Check membership in bucket_members
  const { data: member } = await supabase
    .from('bucket_members')
    .select('id')
    .eq('bucket_id', bucketId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!member) {
    return { authorized: false, isOwner: false, bucket, error: 'You are not a member of this bucket.' };
  }

  return { authorized: true, isOwner: false, bucket, error: null };
}
