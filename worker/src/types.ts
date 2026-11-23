export interface Env {
  B2_ENDPOINT: string;
  B2_BUCKET_NAME: string;
  B2_REGION: string;
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAX_STORAGE_BYTES?: string;
  MAX_FILE_SIZE_BYTES?: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

export interface AuthorizeUploadRequest {
  bucketId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

export interface FinalizeUploadRequest {
  reservationId: string;
  fileId: string;
  actualSize: number;
  checksum?: string;
}

export interface AbortUploadRequest {
  reservationId: string;
  fileId?: string;
}

export interface AuthorizeDownloadRequest {
  fileId: string;
}

// ─── Multipart Upload Types ───

export interface InitiateMultipartRequest {
  bucketId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

export interface InitiateMultipartResult {
  reservationId: string;
  fileId: string;
  multipartUploadId: string;
  uploadId: string;
  objectKey: string;
  partSize: number;
  totalParts: number;
  expiresInSeconds: number;
}

export interface GetPartUrlRequest {
  multipartUploadId: string;
  partNumber: number;
}

export interface GetPartUrlResult {
  partNumber: number;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface RecordPartRequest {
  multipartUploadId: string;
  partNumber: number;
  etag: string;
  partSize: number;
}

export interface RecordPartResult {
  success: boolean;
  partNumber: number;
  completedParts: number;
  uploadedBytes: number;
}

export interface CompleteMultipartRequest {
  multipartUploadId: string;
  parts: MultipartPartInfo[];
}

export interface MultipartPartInfo {
  partNumber: number;
  etag: string;
}

export interface CompleteMultipartResult {
  success: boolean;
  fileId: string;
  objectKey: string;
  totalSize: number;
  checksum: string | null;
}

export interface AbortMultipartRequest {
  multipartUploadId: string;
}

export interface AbortMultipartResult {
  success: boolean;
  status: string;
}

export interface MultipartStatusResult {
  multipartUploadId: string;
  reservationId: string;
  uploadId: string;
  objectKey: string;
  totalSize: number;
  partSize: number;
  totalParts: number;
  status: string;
  completedParts: number;
  uploadedBytes: number;
  expiresAt: string;
  parts: MultipartPartRecord[];
}

export interface MultipartPartRecord {
  partNumber: number;
  etag: string;
  partSize: number;
  uploadedAt: string;
}

export type UploadStatus =
  | 'initiated'
  | 'uploading'
  | 'paused'
  | 'completed'
  | 'aborted'
  | 'expired';
