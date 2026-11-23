/**
 * Core domain types for Photo De Jaldi
 */

export type BucketStatus = 'active' | 'completed' | 'expired' | 'deleting';

export type MemberRole = 'owner' | 'member';

export interface BucketFile {
  id: string;
  bucketId: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  storageKey: string;
  createdAt: string;
}

export interface BucketMember {
  id: string;
  bucket_id: string;
  user_id: string;
  role: string;
  invited_at: string;
  joined_at?: string | null;
  created_at: string;
  user_email?: string | null;
}

export interface Bucket {
  id: string;
  name: string;
  description?: string | null;
  created_by: string;
  expires_at: string;
  status: BucketStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  // Optional client joins
  creator_email?: string | null;
  members?: BucketMember[];
  files_count?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  createdAt: string;
}

export interface CreateBucketInput {
  name: string;
  description?: string;
  expires_at: string;
}

export interface UpdateBucketInput {
  name?: string;
  description?: string | null;
  expires_at?: string;
  status?: BucketStatus;
}
