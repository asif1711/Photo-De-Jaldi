/**
 * Storage Service
 *
 * All file operations go through the Cloudflare Worker backend.
 * B2 credentials are NEVER stored on the client — only short-lived presigned URLs
 * are returned to the mobile app.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { File, FileMode } from 'expo-file-system';
import { supabase } from './supabase';
import { AppConfig } from '@/constants/Config';

// Module-level cache for fetch(uri).blob() fallback — resolved once per URI per session
const blobCache = new Map<string, Promise<Blob>>();

async function getCachedBlob(uri: string): Promise<Blob> {
  let promise = blobCache.get(uri);
  if (!promise) {
    promise = (async () => {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch file for fallback: HTTP ${response.status}`);
      }
      return response.blob();
    })();
    blobCache.set(uri, promise);
  }
  return promise;
}

/**
 * Release a cached blob for a URI. Call on upload complete/cancel/abort.
 */
export function releaseCachedBlob(uri: string): void {
  blobCache.delete(uri);
}

/**
 * Read a single part from a file URI, trying the modern File API first,
 * falling back to fetch(uri).blob() slicing on permission errors.
 * Returns a fetch-compatible body (Uint8Array or Blob).
 */
async function readPart(uri: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer> | Blob> {
  // Try modern File API first
  try {
    const file = new File(uri);
    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = start;
      const bytes = await handle.readBytes(length);
      return bytes;
    } finally {
      handle.close();
    }
  } catch {
    // Fall back to fetch(uri).blob() — read once, cached per session
    const blob = await getCachedBlob(uri);
    return blob.slice(start, start + length);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiFile {
  id: string;
  bucket_id: string;
  file_name: string;
  object_key: string;
  mime_type: string;
  file_size: number;
  checksum: string | null;
  upload_status: 'pending' | 'uploaded' | 'failed' | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface StorageUsageResult {
  total_bytes: number;
  committed_bytes: number;
  reserved_bytes: number;
  available_bytes: number;
  limit_bytes: number;
  utilization_percent: number;
}

export interface AuthorizeUploadResult {
  reservationId: string;
  fileId: string;
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface FinalizeUploadResult {
  fileId: string;
  actualSize: number;
  checksum: string | null;
}

export interface AuthorizeDownloadResult {
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  expiresInSeconds: number;
}

export interface DeleteFileResult {
  freedBytes: number;
}

export const MAX_FILES_PER_DELETE_ACTION = 50;
const FILE_DELETE_CONCURRENCY = 5;

export interface DeleteFilesResult {
  deletedFileIds: string[];
  failedFileIds: string[];
}

// ─── Multipart Upload Types ───

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

export interface GetPartUrlResult {
  partNumber: number;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface UploadPartResult {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('Not authenticated. Please sign in again.');
  }
  return data.session.access_token;
}

function apiUrl(path: string): string {
  const base = AppConfig.endpoints.apiBaseUrl.replace(/\/$/, '');
  return `${base}${path}`;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  const json = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    const errMsg =
      (json as { error?: string }).error ||
      `Request failed with status ${response.status}`;
    throw new Error(errMsg);
  }

  return json;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve global storage quota across all users.
 */
export async function getStorageUsage(): Promise<StorageUsageResult> {
  return apiFetch<StorageUsageResult>('/storage/usage');
}

/**
 * Atomically reserve quota and obtain a presigned PUT URL.
 */
export async function authorizeUpload(
  bucketId: string,
  fileName: string,
  fileSize: number,
  mimeType: string
): Promise<AuthorizeUploadResult> {
  return apiFetch<AuthorizeUploadResult>('/uploads/authorize', {
    method: 'POST',
    body: JSON.stringify({ bucketId, fileName, fileSize, mimeType }),
  });
}

/**
 * PUT the file bytes directly to Backblaze B2 using the presigned URL.
 */
export async function uploadFileToB2(
  uploadUrl: string,
  localUri: string,
  mimeType: string
): Promise<void> {
  const uploadResult = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'PUT',
    headers: {
      'Content-Type': mimeType,
    },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(
      `B2 upload failed with HTTP ${uploadResult.status}: ${uploadResult.body}`
    );
  }
}

/**
 * Confirm a successful upload and commit the quota reservation.
 */
export async function finalizeUpload(
  reservationId: string,
  fileId: string,
  actualSize?: number,
  checksum?: string
): Promise<FinalizeUploadResult> {
  return apiFetch<FinalizeUploadResult>('/uploads/finalize', {
    method: 'POST',
    body: JSON.stringify({ reservationId, fileId, actualSize, checksum }),
  });
}

/**
 * Abort an in-progress upload and release the reserved quota.
 */
export async function abortUpload(
  reservationId: string,
  fileId?: string
): Promise<void> {
  await apiFetch('/uploads/abort', {
    method: 'POST',
    body: JSON.stringify({ reservationId, fileId }),
  });
}

/**
 * Obtain a short-lived presigned GET URL for a file.
 */
export async function authorizeDownload(
  fileId: string
): Promise<AuthorizeDownloadResult> {
  return apiFetch<AuthorizeDownloadResult>('/downloads/authorize', {
    method: 'POST',
    body: JSON.stringify({ fileId }),
  });
}

/**
 * List all uploaded files in a bucket.
 */
export async function getBucketFiles(bucketId: string): Promise<ApiFile[]> {
  const result = await apiFetch<{ success: boolean; files: ApiFile[] }>(
    `/buckets/${bucketId}/files`
  );
  return result.files;
}

/**
 * Delete a file from B2 and release its quota. Owner only.
 */
export async function deleteFile(fileId: string): Promise<DeleteFileResult> {
  return apiFetch<DeleteFileResult>(`/files/${fileId}`, {
    method: 'DELETE',
  });
}

export async function deleteFiles(fileIds: string[]): Promise<DeleteFilesResult> {
  const uniqueFileIds = Array.from(new Set(fileIds));
  if (uniqueFileIds.length > MAX_FILES_PER_DELETE_ACTION) {
    throw new Error(`You can delete up to ${MAX_FILES_PER_DELETE_ACTION} files at once.`);
  }

  const result: DeleteFilesResult = { deletedFileIds: [], failedFileIds: [] };
  for (let start = 0; start < uniqueFileIds.length; start += FILE_DELETE_CONCURRENCY) {
    const batch = uniqueFileIds.slice(start, start + FILE_DELETE_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((fileId) => deleteFile(fileId)));
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        result.deletedFileIds.push(batch[index]);
      } else {
        result.failedFileIds.push(batch[index]);
      }
    });
  }

  return result;
}

/**
 * Initiate a multipart upload session. Reserves quota and returns
 * part size, total parts, and B2 UploadId.
 */
export async function initiateMultipartUpload(
  bucketId: string,
  fileName: string,
  fileSize: number,
  mimeType: string
): Promise<InitiateMultipartResult> {
  return apiFetch<InitiateMultipartResult>('/uploads/multipart/initiate', {
    method: 'POST',
    body: JSON.stringify({ bucketId, fileName, fileSize, mimeType }),
  });
}

/**
 * Get a short-lived presigned PUT URL for a specific part number.
 */
export async function getPartUploadUrl(
  multipartUploadId: string,
  partNumber: number
): Promise<GetPartUrlResult> {
  return apiFetch<GetPartUrlResult>('/uploads/multipart/part-url', {
    method: 'POST',
    body: JSON.stringify({ multipartUploadId, partNumber }),
  });
}

/**
 * Record an uploaded part in Supabase after a successful PUT to B2.
 * Moves the session from 'initiated' to 'uploading' and tracks the part.
 */
export interface RecordPartResult {
  success: boolean;
  partNumber: number;
  completedParts: number;
  uploadedBytes: number;
}

export async function recordMultipartPart(
  multipartUploadId: string,
  partNumber: number,
  etag: string,
  partSize: number
): Promise<RecordPartResult> {
  return apiFetch<RecordPartResult>('/uploads/multipart/record-part', {
    method: 'POST',
    body: JSON.stringify({ multipartUploadId, partNumber, etag, partSize }),
  });
}

/**
 * Throws an Error tagged with a retryable flag so the upload loop can decide
 * whether to back off and retry or fail immediately.
 */
function uploadErr(message: string, retryable: boolean): Error {
  const err = new Error(message);
  (err as any).retryable = retryable;
  return err;
}

/**
 * Upload a single part to B2 using a presigned URL.
 * Returns the ETag from B2 response headers.
 *
 * Uses readPart() (modern File API with fetch fallback) to obtain the part body,
 * then PUTs it to the presigned B2 URL. When requested, XHR reports actual
 * transfer progress for the individual part.
 */
export async function uploadPart(
  uploadUrl: string,
  localUri: string,
  partNumber: number,
  startByte: number,
  endByte: number,
  mimeType: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<UploadPartResult> {
  // Diagnostics: URI scheme and directory
  const uriScheme = localUri.split('://')[0] || 'unknown';
  const partLength = endByte - startByte;
  console.log(
    `[uploadPart] part=${partNumber} scheme=${uriScheme} startByte=${startByte} partLength=${partLength}`
  );
  console.log('[uploadPart] uri dir:', localUri.replace(/[^/]*$/, ''));

  const body = await readPart(localUri, startByte, partLength).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    throw uploadErr(
      `File/permission error reading part ${partNumber}: ${msg}`,
      false
    );
  });

  // Log bytes read
  const bytesRead = body instanceof Uint8Array ? body.byteLength : body.size;
  console.log(
    `[uploadPart] part=${partNumber} readBytes=${bytesRead} expected=${partLength}`
  );

  let responseStatus = 0;
  let etag = '';
  if (onProgress) {
    const putPartWithProgress = (
      includeContentRange: boolean
    ): Promise<{ status: number; responseText: string; etag: string }> =>
      new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('PUT', uploadUrl);
        request.setRequestHeader('Content-Type', mimeType);
        if (includeContentRange) {
          request.setRequestHeader(
            'Content-Range',
            `bytes ${startByte}-${endByte - 1}/*`
          );
        }
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress(event.loaded, event.total);
          }
        };
        request.onload = () => {
          resolve({
            status: request.status,
            responseText: request.responseText,
            etag: request.getResponseHeader('etag') || request.getResponseHeader('ETag') || '',
          });
        };
        request.onerror = () => {
          reject(uploadErr(`Network error uploading part ${partNumber}.`, true));
        };
        request.onabort = () => {
          reject(uploadErr(`Upload of part ${partNumber} was interrupted.`, true));
        };
        request.send(body);
      });

    let response: { status: number; responseText: string; etag: string };
    try {
      response = await putPartWithProgress(true);
    } catch (error) {
      if (error instanceof Error && 'retryable' in error) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw uploadErr(`Network error uploading part ${partNumber}: ${message}`, true);
    }

    if (
      response.status === 403 &&
      response.responseText.includes('SignatureDoesNotMatch')
    ) {
      response = await putPartWithProgress(false);
    }
    responseStatus = response.status;
    if (response.status < 200 || response.status >= 300) {
      const retryable = response.status === 429 || response.status >= 500;
      throw uploadErr(
        `Part ${partNumber} upload failed with HTTP ${response.status}: ${response.responseText}`,
        retryable
      );
    }
    etag = response.etag;
  } else {
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Range': `bytes ${startByte}-${endByte - 1}/*`,
        },
        body,
      });
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      throw uploadErr(`Network error uploading part ${partNumber}: ${msg}`, true);
    }

    if (response.status === 403) {
      const errorBody = await response.text();
      if (errorBody.includes('SignatureDoesNotMatch')) {
        response = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
          body,
        });
      } else {
        throw uploadErr(
          `Part ${partNumber} upload failed with HTTP ${response.status}: ${errorBody}`,
          false
        );
      }
    }

    if (!response.ok) {
      const bodyText = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      throw uploadErr(
        `Part ${partNumber} upload failed with HTTP ${response.status}: ${bodyText}`,
        retryable
      );
    }
    responseStatus = response.status;
    etag = response.headers.get('etag') || response.headers.get('ETag') || '';
  }

  console.log(
    `[uploadPart] part=${partNumber} status=${responseStatus} etagPresent=${!!etag}`
  );

  return {
    partNumber,
    etag,
  };
}

/**
 * Complete a multipart upload. Validates all parts with B2 and commits quota.
 */
export async function completeMultipartUpload(
  multipartUploadId: string,
  parts: { partNumber: number; etag: string }[]
): Promise<CompleteMultipartResult> {
  return apiFetch<CompleteMultipartResult>('/uploads/multipart/complete', {
    method: 'POST',
    body: JSON.stringify({ multipartUploadId, parts }),
  });
}

/**
 * Abort an in-progress multipart upload. Releases quota and cleans up B2 parts.
 */
export async function abortMultipartUpload(
  multipartUploadId: string
): Promise<AbortMultipartResult> {
  return apiFetch<AbortMultipartResult>('/uploads/multipart/abort', {
    method: 'POST',
    body: JSON.stringify({ multipartUploadId }),
  });
}

/**
 * Get the current status of a multipart upload session, including
 * completed parts and uploaded bytes.
 */
export async function getMultipartStatus(
  multipartUploadId: string
): Promise<MultipartStatusResult> {
  return apiFetch<MultipartStatusResult>(
    `/uploads/multipart/status?multipartUploadId=${encodeURIComponent(multipartUploadId)}`,
    { method: 'GET' }
  );
}

/**
 * Download a file to the device's cache directory and return the local URI.
 */
export async function downloadFileToCache(
  downloadUrl: string,
  fileName: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Cache directory is unavailable.');

  const safeName = fileName.replace(/[^a-zA-Z0-9._\- ]/g, '_');
  const destUri = `${cacheDir}${safeName}`;

  const downloadResumable = FileSystem.createDownloadResumable(
    downloadUrl,
    destUri,
    {},
    (downloadProgress) => {
      const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
      if (totalBytesExpectedToWrite > 0 && onProgress) {
        onProgress(totalBytesWritten / totalBytesExpectedToWrite);
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result) throw new Error('Download failed — no result returned.');

  return result.uri;
}
