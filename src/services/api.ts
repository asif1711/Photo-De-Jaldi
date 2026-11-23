/**
 * Cloudflare Workers API Client Interface
 *
 * Provides typed contract boundaries for backend API calls.
 * Backend implementation will be connected during the backend integration phase.
 */

import { AppConfig } from '@/constants/Config';
import { Bucket, BucketMember } from '@/types';

export interface CreateBucketParams {
  name: string;
  expiryHours: number;
  invitedEmails: string[];
}

export interface ApiClientContract {
  createBucket(params: CreateBucketParams): Promise<Bucket>;
  getBucket(bucketId: string): Promise<Bucket>;
  listMyBuckets(): Promise<Bucket[]>;
  listSharedBuckets(): Promise<Bucket[]>;
  listHistoryBuckets(): Promise<Bucket[]>;
  inviteMember(bucketId: string, email: string): Promise<BucketMember>;
  markDownloadComplete(bucketId: string): Promise<{ success: boolean; allDownloaded: boolean }>;
  deleteBucket(bucketId: string): Promise<{ success: boolean }>;
}

// Client stub placeholder - awaits backend phase
export const apiConfig = {
  baseUrl: AppConfig.endpoints.apiBaseUrl,
};
