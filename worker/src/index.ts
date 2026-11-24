import {
  authenticateRequest,
  getBucketAvailabilityError,
  getSupabaseAdmin,
  verifyBucketAccess,
} from './auth';
import {
  deleteB2Object,
  generateDownloadPresignedUrl,
  generateUploadPresignedUrl,
  verifyB2Object,
  initiateMultipartUpload,
  generatePartPresignedUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  listMultipartParts,
  listB2Objects,
  calculateTotalParts,
  DEFAULT_PART_SIZE,
} from './s3';
import { runExpiredBucketCleanup } from './expiryCleanup';
import { APP_LIMITS } from './caps';
import {
  AbortMultipartRequest,
  AbortMultipartResult,
  AbortUploadRequest,
  AuthorizeDownloadRequest,
  AuthorizeUploadRequest,
  CompleteMultipartRequest,
  CompleteMultipartResult,
  Env,
  FinalizeUploadRequest,
  InitiateMultipartRequest,
  InitiateMultipartResult,
  GetPartUrlRequest,
  GetPartUrlResult,
  MultipartStatusResult,
  RecordPartRequest,
  RecordPartResult,
} from './types';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MULTIPART_EXPIRES_SECONDS = 3600; // 1 hour for multipart sessions
const PART_URL_EXPIRES_SECONDS = 600; // 10 minutes per part URL

interface GlobalStorageUsageData {
  maximum_bytes: number;
  committed_bytes: number;
  reserved_bytes: number;
  available_bytes: number;
  percent_used: number;
  is_limit_reached: boolean;
}

interface FileStatusBreakdownData {
  file_status: 'uploaded' | 'expired' | 'deleted';
  file_count: number;
  total_bytes: number;
}

function jsonResponse(
  data: any,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message, success: false }, status);
}

/**
 * Best-effort rollback used when a multipart upload failed permanently AFTER
 * B2 finished the object. Deletes the orphaned object, releases the quota
 * reservation and ensures no multipart_uploads row is left in a non-terminal
 * state.
 */
async function cleanupFailedCompletion(
  env: Env,
  supabase: any,
  upload: { id: string; reservation_id: string; object_key: string }
): Promise<void> {
  try {
    await deleteB2Object(env, upload.object_key);
  } catch {
    // Best effort — the object may already be gone.
  }
  try {
    await supabase.rpc('abort_upload', { p_reservation_id: upload.reservation_id });
  } catch {
    // Best effort — quota release will otherwise be reconciled.
  }
  try {
    // abort_multipart_upload refuses a 'completed' session, so update directly.
    await supabase.from('multipart_uploads').update({ status: 'aborted' }).eq('id', upload.id);
  } catch {
    // Best effort.
  }
}

function bucketIdFromObjectKey(objectKey: string): string | null {
  const match = objectKey.match(/^buckets\/([0-9a-fA-F-]+)\/.+$/);
  return match ? match[1] : null;
}

function decodeObjectKey(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function fallbackFileName(objectKey: string): string {
  const lastSegment = objectKey.split('/').pop() || objectKey;
  return lastSegment.replace(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-/,
    ''
  );
}

function guessMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    heic: 'image/heic',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    m4a: 'audio/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    png: 'image/png',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    wav: 'audio/wav',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
  };
  return (extension && mimeTypes[extension]) || 'application/octet-stream';
}

export default {
  scheduled(
    _controller: { cron: string; scheduledTime: number },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ) {
    ctx.waitUntil(
      runExpiredBucketCleanup(env).catch((error: unknown) => {
        console.error('[expiry-cleanup] Scheduled run failed', {
          error: error instanceof Error ? error.message : 'Unknown cleanup error',
        });
      })
    );
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ----------------------------------------------------------------------
      // 1. GET /storage/usage - Global Storage Accounting
      // ----------------------------------------------------------------------
      if (path === '/storage/usage' && request.method === 'GET') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const supabase = getSupabaseAdmin(env);
        const { data: usageData, error: usageError } = await supabase.rpc('get_storage_usage');

        if (usageError) {
          console.error('[storage] Usage retrieval failed', { error: usageError.message });
          return errorResponse('Storage usage is temporarily unavailable.', 500);
        }

        const usage = usageData as GlobalStorageUsageData | null;
        if (
          !usage ||
          !Number.isFinite(usage.maximum_bytes) ||
          !Number.isFinite(usage.committed_bytes) ||
          !Number.isFinite(usage.reserved_bytes) ||
          !Number.isFinite(usage.available_bytes) ||
          !Number.isFinite(usage.percent_used) ||
          typeof usage.is_limit_reached !== 'boolean'
        ) {
          console.error('[storage] Usage RPC returned an invalid response');
          return errorResponse('Storage usage is temporarily unavailable.', 500);
        }

        const { data: breakdownData, error: breakdownError } = await supabase.rpc(
          'get_file_status_breakdown'
        );
        const breakdownRows = Array.isArray(breakdownData)
          ? (breakdownData as FileStatusBreakdownData[])
          : null;
        const expectedStatuses: FileStatusBreakdownData['file_status'][] = [
          'uploaded',
          'expired',
          'deleted',
        ];
        const validBreakdown =
          breakdownRows?.length === expectedStatuses.length &&
          expectedStatuses.every((status) =>
            breakdownRows.some(
              (row) =>
                row.file_status === status &&
                Number.isFinite(row.file_count) &&
                Number.isFinite(row.total_bytes)
            )
          );
        if (breakdownError || !breakdownRows || !validBreakdown) {
          console.error('[storage] File status breakdown retrieval failed', {
            error: breakdownError?.message ?? 'Invalid aggregate response',
          });
          return errorResponse('Storage breakdown is temporarily unavailable.', 500);
        }

        return jsonResponse({
          ...usage,
          total_bytes: usage.committed_bytes + usage.reserved_bytes,
          limit_bytes: usage.maximum_bytes,
          utilization_percent: usage.percent_used,
          file_status_breakdown: breakdownRows,
        });
      }

      // ----------------------------------------------------------------------
      // 2. POST /uploads/authorize - Atomic Quota Check & Presigned PUT
      //      Single-upload path (files under 5 MB use simple PUT)
      // ----------------------------------------------------------------------
      if (path === '/uploads/authorize' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as AuthorizeUploadRequest;
        if (!body.bucketId || !body.fileName || !body.fileSize) {
          return errorResponse('Missing required fields: bucketId, fileName, fileSize.');
        }

        if (body.fileSize <= 0) {
          return errorResponse('File size must be greater than zero.');
        }

        // Enforce 5 GB per-file limit in the Worker
        if (body.fileSize > APP_LIMITS.MAX_FILE_SIZE_BYTES) {
          return errorResponse(
            `File size exceeds maximum of 5 GB (${body.fileSize} bytes requested).`,
            400
          );
        }

        const supabase = getSupabaseAdmin(env);

        // Verify user has access to the target bucket
        const { authorized, error: accessError, bucket } = await verifyBucketAccess(
          supabase,
          body.bucketId,
          user.id
        );

        if (!authorized || accessError) {
          return errorResponse(accessError || 'Access denied to target bucket.', 403);
        }

        // Verify bucket is active and not expired
        if (bucket.status !== 'active' || new Date(bucket.expires_at).getTime() <= Date.now()) {
          return errorResponse('Cannot upload to an expired or inactive bucket.', 400);
        }

        // Stale session cleanup: abort sessions with no activity for 24 hours
        const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: staleSessions } = await supabase
          .from('multipart_uploads')
          .select('id, object_key, upload_id, reservation_id')
          .eq('user_id', user.id)
          .in('status', ['initiated', 'uploading', 'paused'])
          .lt('updated_at', staleCutoff);

        if (staleSessions && staleSessions.length > 0) {
          for (const session of staleSessions) {
            // Best effort B2 abort
            try {
              await abortMultipartUpload(env, session.object_key, session.upload_id);
            } catch {
              // Ignore — Supabase state is authoritative
            }
            // Mark as aborted in DB
            try {
              await supabase.rpc('abort_multipart_upload', {
                p_multipart_upload_id: session.id,
              });
            } catch {
              // Ignore
            }
            // Release reserved quota
            try {
              await supabase.rpc('abort_upload', {
                p_reservation_id: session.reservation_id,
              });
            } catch {
              // Ignore
            }
          }
        }

        // Call atomic PostgreSQL function to reserve quota and insert pending record
        const { data: reservation, error: rpcError } = await supabase.rpc('reserve_storage', {
          p_bucket_id: body.bucketId,
          p_user_id: user.id,
          p_file_name: body.fileName,
          p_file_size: body.fileSize,
          p_mime_type: body.mimeType || 'application/octet-stream',
          p_expires_seconds: 600, // 10 minutes
        });

        if (rpcError) {
          return errorResponse(rpcError.message, 400);
        }

        // Generate short-lived Backblaze B2 presigned PUT URL
        const uploadUrl = await generateUploadPresignedUrl(
          env,
          reservation.object_key,
          body.mimeType || 'application/octet-stream',
          600
        );

        return jsonResponse({
          success: true,
          reservationId: reservation.reservation_id,
          fileId: reservation.file_id,
          objectKey: reservation.object_key,
          uploadUrl,
          expiresInSeconds: 600,
        });
      }

      // ----------------------------------------------------------------------
      // 3. POST /uploads/multipart/initiate - Start Multipart Upload Session
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/initiate' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as InitiateMultipartRequest;
        if (!body.bucketId || !body.fileName || !body.fileSize) {
          return errorResponse('Missing required fields: bucketId, fileName, fileSize.');
        }

        if (body.fileSize <= 0) {
          return errorResponse('File size must be greater than zero.');
        }

        // Enforce 5 GB per-file limit in the Worker
        if (body.fileSize > APP_LIMITS.MAX_FILE_SIZE_BYTES) {
          return errorResponse(
            `File size exceeds maximum of 5 GB (${body.fileSize} bytes requested).`,
            400
          );
        }

        const supabase = getSupabaseAdmin(env);

        // Verify user has access to the target bucket
        const { authorized, error: accessError, bucket } = await verifyBucketAccess(
          supabase,
          body.bucketId,
          user.id
        );

        if (!authorized || accessError) {
          return errorResponse(accessError || 'Access denied to target bucket.', 403);
        }

        // Verify bucket is active and not expired
        if (bucket.status !== 'active' || new Date(bucket.expires_at).getTime() <= Date.now()) {
          return errorResponse('Cannot upload to an expired or inactive bucket.', 400);
        }

        // Reserve quota atomically
        const { data: reservation, error: rpcError } = await supabase.rpc('reserve_storage', {
          p_bucket_id: body.bucketId,
          p_user_id: user.id,
          p_file_name: body.fileName,
          p_file_size: body.fileSize,
          p_mime_type: body.mimeType || 'application/octet-stream',
          p_expires_seconds: MULTIPART_EXPIRES_SECONDS,
        });

        if (rpcError) {
          return errorResponse(rpcError.message, 400);
        }

        // Calculate multipart parameters
        const partSize = DEFAULT_PART_SIZE;
        const totalParts = calculateTotalParts(body.fileSize, partSize);

        // Initiate multipart upload in B2 first to get the real UploadId.
        // We must not insert an empty upload_id into Supabase because the
        // upload_id column has a CHECK constraint requiring non-empty values.
        let b2UploadId: string;
        try {
          const b2Result = await initiateMultipartUpload(
            env,
            reservation.object_key,
            body.mimeType || 'application/octet-stream'
          );
          b2UploadId = b2Result.uploadId;
        } catch (b2Err: any) {
          // Rollback: abort reservation. No multipart_uploads row exists yet.
          await supabase.rpc('abort_upload', { p_reservation_id: reservation.reservation_id });
          return errorResponse(
            `Failed to initiate B2 multipart upload: ${b2Err.message}`,
            502
          );
        }

        // Track multipart upload session in Supabase with the real B2 UploadId.
        const { data: tracking, error: trackingError } = await supabase.rpc(
          'create_multipart_upload_tracking',
          {
            p_reservation_id: reservation.reservation_id,
            p_bucket_id: body.bucketId,
            p_user_id: user.id,
            p_object_key: reservation.object_key,
            p_upload_id: b2UploadId,
            p_total_size: body.fileSize,
            p_part_size: partSize,
            p_total_parts: totalParts,
            p_expires_seconds: MULTIPART_EXPIRES_SECONDS,
          }
        );

        if (trackingError) {
          // Rollback: abort reservation and B2 multipart upload.
          await supabase.rpc('abort_upload', { p_reservation_id: reservation.reservation_id });
          try {
            await abortMultipartUpload(env, reservation.object_key, b2UploadId);
          } catch {
            // B2 abort may fail if already aborted; Supabase state is authoritative.
          }
          return errorResponse(trackingError.message, 400);
        }

        return jsonResponse({
          success: true,
          reservationId: reservation.reservation_id,
          fileId: reservation.file_id,
          multipartUploadId: tracking.multipart_upload_id,
          uploadId: b2UploadId,
          objectKey: reservation.object_key,
          partSize,
          totalParts,
          expiresInSeconds: MULTIPART_EXPIRES_SECONDS,
        } as InitiateMultipartResult);
      }

      // ----------------------------------------------------------------------
      // 4. POST /uploads/multipart/part-url - Get Presigned URL for a Part
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/part-url' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as GetPartUrlRequest;
        if (!body.multipartUploadId || !body.partNumber) {
          return errorResponse('Missing required fields: multipartUploadId, partNumber.');
        }

        if (body.partNumber <= 0) {
          return errorResponse('Part number must be greater than zero.');
        }

        const supabase = getSupabaseAdmin(env);

        // Verify ownership of the multipart upload
        const { data: upload, error: uploadError } = await supabase
          .from('multipart_uploads')
          .select('*')
          .eq('id', body.multipartUploadId)
          .eq('user_id', user.id)
          .single();

        if (uploadError || !upload) {
          return errorResponse('Multipart upload not found or access denied.', 404);
        }

        if (upload.status === 'completed' || upload.status === 'aborted') {
          return errorResponse(
            `Cannot get part URL for ${upload.status} multipart upload.`,
            400
          );
        }

        if (upload.status === 'expired' || new Date(upload.expires_at).getTime() <= Date.now()) {
          return errorResponse('Multipart upload session has expired.', 400);
        }

        const { data: bucket, error: bucketError } = await supabase
          .from('buckets')
          .select('status,expires_at')
          .eq('id', upload.bucket_id)
          .maybeSingle();
        if (bucketError || !bucket) {
          return errorResponse('Bucket could not be verified.', 500);
        }
        if (bucket.status !== 'active' || new Date(bucket.expires_at).getTime() <= Date.now()) {
          return errorResponse('Bucket has expired and no longer accepts uploads.', 409);
        }

        // Verify part number is within range
        if (body.partNumber > upload.total_parts) {
          return errorResponse(
            `Part number ${body.partNumber} exceeds total parts ${upload.total_parts}.`,
            400
          );
        }

        // Generate presigned URL for this specific part
        const uploadUrl = await generatePartPresignedUrl(
          env,
          upload.object_key,
          upload.upload_id,
          body.partNumber,
          PART_URL_EXPIRES_SECONDS
        );

        return jsonResponse({
          partNumber: body.partNumber,
          uploadUrl,
          expiresInSeconds: PART_URL_EXPIRES_SECONDS,
        } as GetPartUrlResult);
      }

      // ----------------------------------------------------------------------
      // 4.5. POST /uploads/multipart/record-part - Record an uploaded part
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/record-part' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as RecordPartRequest;
        if (!body.multipartUploadId || !body.partNumber || !body.etag || !body.partSize) {
          return errorResponse('Missing required fields: multipartUploadId, partNumber, etag, partSize.');
        }

        if (body.partNumber <= 0) {
          return errorResponse('Part number must be greater than zero.');
        }

        const supabase = getSupabaseAdmin(env);

        // Verify ownership of the multipart upload
        const { data: upload, error: uploadError } = await supabase
          .from('multipart_uploads')
          .select('*')
          .eq('id', body.multipartUploadId)
          .eq('user_id', user.id)
          .single();

        if (uploadError || !upload) {
          return errorResponse('Multipart upload not found or access denied.', 404);
        }

        if (upload.status === 'completed' || upload.status === 'aborted') {
          return errorResponse(
            `Cannot record part for ${upload.status} multipart upload.`,
            400
          );
        }

        if (upload.status === 'expired' || new Date(upload.expires_at).getTime() <= Date.now()) {
          return errorResponse('Multipart upload session has expired.', 400);
        }

        // Verify part number is within range
        if (body.partNumber > upload.total_parts) {
          return errorResponse(
            `Part number ${body.partNumber} exceeds total parts ${upload.total_parts}.`,
            400
          );
        }

        // Record the part in Supabase via atomic RPC
        const { data: recordResult, error: recordError } = await supabase.rpc(
          'record_multipart_part',
          {
            p_multipart_upload_id: body.multipartUploadId,
            p_part_number: body.partNumber,
            p_etag: body.etag,
            p_part_size: body.partSize,
          }
        );

        if (recordError) {
          return errorResponse(recordError.message, 400);
        }

        return jsonResponse({
          success: true,
          partNumber: body.partNumber,
          completedParts: recordResult.completed_parts,
          uploadedBytes: recordResult.uploaded_bytes,
        } as RecordPartResult);
      }

      // ----------------------------------------------------------------------
      // 5. POST /uploads/multipart/complete - Complete Multipart Upload
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/complete' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as CompleteMultipartRequest;
        if (!body.multipartUploadId || !body.parts) {
          return errorResponse('Missing required fields: multipartUploadId, parts.');
        }

        if (!Array.isArray(body.parts) || body.parts.length === 0) {
          return errorResponse('At least one part is required to complete.');
        }

        const supabase = getSupabaseAdmin(env);

        // ------------------------------------------------------------------
        // Step 1: Read-only validation (NO side effects, NO B2 calls)
        // ------------------------------------------------------------------
        const { data: upload, error: uploadError } = await supabase
          .from('multipart_uploads')
          .select('*')
          .eq('id', body.multipartUploadId)
          .eq('user_id', user.id)
          .single();

        if (uploadError || !upload) {
          return errorResponse('Multipart upload not found or access denied.', 404);
        }

        const alreadyCompleted = upload.status === 'completed';

        // Any state other than 'uploading' (or a resumed 'completed') is invalid.
        if (!alreadyCompleted && upload.status !== 'uploading') {
          return errorResponse(
            `Cannot complete a multipart upload in '${upload.status}' state.`,
            400
          );
        }

        if (upload.completed_parts !== upload.total_parts) {
          return errorResponse(
            `Multipart upload has ${upload.completed_parts} of ${upload.total_parts} parts recorded.`,
            400
          );
        }

        // Recorded parts are authoritative for the B2 CompleteMultipartUpload call.
        const { data: recordedParts, error: partsError } = await supabase
          .from('multipart_parts')
          .select('part_number, etag')
          .eq('multipart_upload_id', body.multipartUploadId)
          .order('part_number', { ascending: true });

        if (partsError || !recordedParts || recordedParts.length !== upload.total_parts) {
          return errorResponse('Recorded parts are incomplete or unavailable.', 400);
        }

        // The parts sent by the client must match the recorded parts exactly.
        const sortedClientParts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
        if (sortedClientParts.length !== recordedParts.length) {
          return errorResponse(
            `Expected ${recordedParts.length} parts, received ${sortedClientParts.length}.`,
            400
          );
        }
        for (let i = 0; i < recordedParts.length; i++) {
          const rec = recordedParts[i] as { part_number: number; etag: string };
          const sent = sortedClientParts[i];
          if (rec.part_number !== sent.partNumber || rec.etag !== sent.etag) {
            return errorResponse(
              `Part ${rec.part_number} does not match the recorded upload.`,
              400
            );
          }
        }

        // Idempotency: a completed session whose quota is already committed is done.
        if (alreadyCompleted) {
          const { data: reservation } = await supabase
            .from('upload_reservations')
            .select('reservation_status')
            .eq('id', upload.reservation_id)
            .maybeSingle();

          if (reservation?.reservation_status === 'committed') {
            return jsonResponse({
              success: true,
              fileId: upload.reservation_id,
              objectKey: upload.object_key,
              totalSize: upload.total_size,
              checksum: null,
            } as CompleteMultipartResult);
          }
          // Otherwise fall through and resume the unfinished tail (verify + commit).
        }

        if (!alreadyCompleted) {
          const { data: bucket, error: bucketError } = await supabase
            .from('buckets')
            .select('status,expires_at')
            .eq('id', upload.bucket_id)
            .maybeSingle();
          if (bucketError || !bucket) {
            return errorResponse('Bucket could not be verified.', 500);
          }
          if (bucket.status !== 'active' || new Date(bucket.expires_at).getTime() <= Date.now()) {
            return errorResponse('Bucket has expired and no longer accepts uploads.', 409);
          }
        }

        const completedParts: { ETag: string; PartNumber: number }[] = recordedParts.map(
          (p: any) => ({ ETag: p.etag, PartNumber: p.part_number })
        );

        // ------------------------------------------------------------------
        // Step 2: Complete the object in B2 (skipped when resuming a completed session)
        // ------------------------------------------------------------------
        let verifiedSize: number | null = null;
        let verifiedChecksum: string | null = null;
        if (!alreadyCompleted) {
          try {
            await completeMultipartUpload(
              env,
              upload.object_key,
              upload.upload_id,
              completedParts
            );
          } catch (b2Err: any) {
            // A retry can reach B2 after the first completion succeeded but its
            // response was lost. Confirm the finished object before failing.
            try {
              const priorCompletion = await verifyB2Object(env, upload.object_key);
              if (priorCompletion.exists) {
                if (priorCompletion.size !== upload.total_size) {
                  await cleanupFailedCompletion(env, supabase, upload);
                  return errorResponse(
                    `Completed object size mismatch (expected ${upload.total_size}, found ${priorCompletion.size} bytes).`,
                    502
                  );
                }
                verifiedSize = priorCompletion.size;
                verifiedChecksum = priorCompletion.checksum ?? null;
              }
            } catch {
              // Without verification, retain the original B2 completion failure.
            }

            if (verifiedSize === null) {
              console.error('[multipart/complete] B2 complete failed');
              return errorResponse(
                `Failed to complete B2 multipart upload: ${b2Err.message}`,
                502
              );
            }
          }
        }

        // ------------------------------------------------------------------
        // Step 3: Best-effort size verification through ListObjectsV2.
        // ------------------------------------------------------------------
        if (verifiedSize === null) {
          try {
            const b2Check = await verifyB2Object(env, upload.object_key);
            if (b2Check.exists) {
              if (b2Check.size !== upload.total_size) {
                await cleanupFailedCompletion(env, supabase, upload);
                return errorResponse(
                  `Completed object size mismatch (expected ${upload.total_size}, found ${b2Check.size} bytes).`,
                  502
                );
              }
              verifiedSize = b2Check.size;
              verifiedChecksum = b2Check.checksum ?? null;
            }
          } catch {
            // Verification is diagnostic only; B2 completion remains authoritative.
          }
        }

        // ------------------------------------------------------------------
        // Step 4: Mark session completed (if needed), then commit quota
        // ------------------------------------------------------------------
        if (!alreadyCompleted) {
          const { error: completeError } = await supabase.rpc('complete_multipart_upload', {
            p_multipart_upload_id: body.multipartUploadId,
          });

          if (completeError) {
            const { data: latestUpload, error: stateError } = await supabase
              .from('multipart_uploads')
              .select('status')
              .eq('id', body.multipartUploadId)
              .maybeSingle();

            if (latestUpload?.status !== 'completed') {
              if (!stateError) await cleanupFailedCompletion(env, supabase, upload);
              return errorResponse(stateError?.message || completeError.message, 500);
            }
          }
        }

        const actualSize = verifiedSize ?? upload.total_size;
        const { error: finalizeError } = await supabase.rpc('finalize_upload', {
          p_reservation_id: upload.reservation_id,
          p_actual_size: actualSize,
          p_checksum: verifiedChecksum,
        });

        if (finalizeError) {
          // A concurrent finalize may have already committed the reservation.
          const { data: res } = await supabase
            .from('upload_reservations')
            .select('reservation_status')
            .eq('id', upload.reservation_id)
            .maybeSingle();

          if (res?.reservation_status === 'committed') {
            return jsonResponse({
              success: true,
              fileId: upload.reservation_id,
              objectKey: upload.object_key,
              totalSize: actualSize,
              checksum: verifiedChecksum,
            } as CompleteMultipartResult);
          }

          // Permanent quota-commit failure: roll back to avoid an orphan object.
          await cleanupFailedCompletion(env, supabase, upload);
          return errorResponse(
            `Completed object stored but quota commit failed: ${finalizeError.message}`,
            500
          );
        }

        return jsonResponse({
          success: true,
          fileId: upload.reservation_id, // reservation_id maps to file via upload_reservations
          objectKey: upload.object_key,
          totalSize: actualSize,
          checksum: verifiedChecksum,
        } as CompleteMultipartResult);
      }

      // ----------------------------------------------------------------------
      // 6. POST /uploads/multipart/abort - Cancel Multipart Upload
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/abort' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as AbortMultipartRequest;
        if (!body.multipartUploadId) {
          return errorResponse('Missing multipartUploadId.');
        }

        const supabase = getSupabaseAdmin(env);

        // Get upload details for abort
        const { data: upload, error: uploadError } = await supabase
          .from('multipart_uploads')
          .select('*')
          .eq('id', body.multipartUploadId)
          .eq('user_id', user.id)
          .single();

        if (uploadError || !upload) {
          return errorResponse('Multipart upload not found or access denied.', 404);
        }

        // Tolerant of an already-completed session: report it as non-fatal so the
        // client does not treat a completed upload as an abort failure.
        if (upload.status === 'completed') {
          return jsonResponse({
            success: true,
            status: 'already_completed',
          } as AbortMultipartResult);
        }

        // Mark as aborted in Supabase (idempotent)
        const { error: abortError } = await supabase.rpc('abort_multipart_upload', {
          p_multipart_upload_id: body.multipartUploadId,
        });

        if (abortError) {
          return errorResponse(abortError.message, 400);
        }

        // Abort multipart upload in B2 to clean up parts
        try {
          await abortMultipartUpload(env, upload.object_key, upload.upload_id);
        } catch (b2Err: any) {
          // B2 abort may fail if already aborted; Supabase state is authoritative
          // Log but do not fail the request
        }

        // Release quota reservation via abort_upload RPC
        await supabase.rpc('abort_upload', {
          p_reservation_id: upload.reservation_id,
        });

        return jsonResponse({
          success: true,
          status: 'aborted',
        } as AbortMultipartResult);
      }

      // ----------------------------------------------------------------------
      // 7. GET /uploads/multipart/status - Get Multipart Upload Status
      // ----------------------------------------------------------------------
      if (path === '/uploads/multipart/status' && request.method === 'GET') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const multipartUploadId = url.searchParams.get('multipartUploadId');
        if (!multipartUploadId) {
          return errorResponse('Missing multipartUploadId query parameter.');
        }

        const supabase = getSupabaseAdmin(env);

        // Get upload status with parts (RLS ensures user can only see their own)
        const { data: status, error: statusError } = await supabase.rpc(
          'get_multipart_upload_status',
          { p_multipart_upload_id: multipartUploadId }
        );

        if (statusError || !status) {
          return errorResponse(
            statusError?.message || 'Multipart upload not found or access denied.',
            404
          );
        }

        return jsonResponse(status as MultipartStatusResult);
      }

      // ----------------------------------------------------------------------
      // 8. POST /uploads/finalize - Confirm Physical B2 Write & Commit Quota
      //      Single-upload finalize path
      // ----------------------------------------------------------------------
      if (path === '/uploads/finalize' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as FinalizeUploadRequest;
        if (!body.reservationId || !body.fileId) {
          return errorResponse('Missing required fields: reservationId, fileId.');
        }

        const supabase = getSupabaseAdmin(env);

        // Retrieve reservation and file records
        const { data: file, error: fileError } = await supabase
          .from('bucket_files')
          .select('object_key, file_size, upload_status, bucket_id')
          .eq('id', body.fileId)
          .single();

        if (fileError || !file) {
          return errorResponse('File record not found.', 404);
        }

        const { data: bucket, error: bucketError } = await supabase
          .from('buckets')
          .select('status,expires_at')
          .eq('id', file.bucket_id)
          .maybeSingle();
        if (bucketError || !bucket) {
          return errorResponse('Bucket could not be verified.', 500);
        }
        if (bucket.status !== 'active' || new Date(bucket.expires_at).getTime() <= Date.now()) {
          return errorResponse('Bucket has expired and no longer accepts uploads.', 409);
        }

        // Verify actual object presence in Backblaze B2 via HeadObject
        const b2Check = await verifyB2Object(env, file.object_key);
        if (!b2Check.exists) {
          return errorResponse('Physical object was not found in Backblaze B2 storage.', 400);
        }

        const actualSize = b2Check.size > 0 ? b2Check.size : body.actualSize || file.file_size;

        // Atomically finalize upload and commit quota in Supabase
        const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_upload', {
          p_reservation_id: body.reservationId,
          p_actual_size: actualSize,
          p_checksum: b2Check.checksum || body.checksum || null,
        });

        if (finalizeError) {
          return errorResponse(finalizeError.message, 400);
        }

        return jsonResponse({
          success: true,
          fileId: body.fileId,
          actualSize,
          checksum: b2Check.checksum,
        });
      }

      // ----------------------------------------------------------------------
      // 9. POST /uploads/abort - Cancel Incomplete Upload & Free Reservation
      //      Single-upload abort path
      // ----------------------------------------------------------------------
      if (path === '/uploads/abort' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as AbortUploadRequest;
        if (!body.reservationId) {
          return errorResponse('Missing reservationId.');
        }

        const supabase = getSupabaseAdmin(env);

        // Call atomic abort function
        await supabase.rpc('abort_upload', {
          p_reservation_id: body.reservationId,
        });

        // Clean up partial object from B2 if object key is available
        if (body.fileId) {
          const { data: file } = await supabase
            .from('bucket_files')
            .select('object_key')
            .eq('id', body.fileId)
            .maybeSingle();

          if (file?.object_key) {
            await deleteB2Object(env, file.object_key).catch(() => {});
          }
        }

        return jsonResponse({ success: true, message: 'Upload aborted and reserved quota released.' });
      }

      // ----------------------------------------------------------------------
      // 10. POST /downloads/authorize - Presigned GET URL
      // ----------------------------------------------------------------------
      if (path === '/downloads/authorize' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const body = (await request.json()) as AuthorizeDownloadRequest;
        if (!body.fileId) {
          return errorResponse('Missing fileId.');
        }

        const supabase = getSupabaseAdmin(env);

        // Prefer saved metadata, but external B2 objects may have no database row.
        const { data: file } = await supabase
          .from('bucket_files')
          .select('id, bucket_id, file_name, object_key, mime_type, file_size, upload_status')
          .eq('id', body.fileId)
          .maybeSingle();

        let objectKey: string;
        let fileName: string;
        let fileSize: number;
        let mimeType: string;
        if (file) {
          if (file.upload_status !== 'uploaded') {
            return errorResponse(`File is not available for download (status: ${file.upload_status}).`, 400);
          }

          const { authorized, error: accessError, bucket } = await verifyBucketAccess(
            supabase,
            file.bucket_id,
            user.id
          );
          if (!authorized || accessError) {
            return errorResponse('You are not authorized to download files from this bucket.', 403);
          }
          const availabilityError = bucket && getBucketAvailabilityError(bucket);
          if (availabilityError) {
            return errorResponse(availabilityError.message, availabilityError.status);
          }

          objectKey = file.object_key;
          fileName = file.file_name;
          fileSize = file.file_size;
          mimeType = file.mime_type;
        } else {
          const key = decodeObjectKey(body.fileId);
          const bucketId = key ? bucketIdFromObjectKey(key) : null;
          if (!key || !bucketId || !key.startsWith(`buckets/${bucketId}/`)) {
            return errorResponse('File not found.', 404);
          }

          const { authorized, error: accessError, bucket } = await verifyBucketAccess(
            supabase,
            bucketId,
            user.id
          );
          if (!authorized || accessError) {
            return errorResponse('You are not authorized to download files from this bucket.', 403);
          }
          const availabilityError = bucket && getBucketAvailabilityError(bucket);
          if (availabilityError) {
            return errorResponse(availabilityError.message, availabilityError.status);
          }

          objectKey = key;
          fileName = fallbackFileName(key);
          fileSize = 0;
          mimeType = guessMimeType(fileName);
        }

        // Generate short-lived presigned GET URL (5 minutes)
        const downloadUrl = await generateDownloadPresignedUrl(
          env,
          objectKey,
          fileName,
          300
        );

        return jsonResponse({
          success: true,
          downloadUrl,
          fileName,
          fileSize,
          mimeType,
          expiresInSeconds: 300,
        });
      }

      // ----------------------------------------------------------------------
      // 11. GET /buckets/:id/files - List Bucket Files
      // ----------------------------------------------------------------------
      const bucketFilesMatch = path.match(/^\/buckets\/([0-9a-fA-F-]+)\/files$/);
      if (bucketFilesMatch && request.method === 'GET') {
        const bucketId = bucketFilesMatch[1];
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const supabase = getSupabaseAdmin(env);
        const { authorized, error: accessError, bucket } = await verifyBucketAccess(
          supabase,
          bucketId,
          user.id
        );

        if (!authorized || accessError) {
          return errorResponse('Access denied to bucket files.', 403);
        }
        const availabilityError = bucket && getBucketAvailabilityError(bucket);
        if (availabilityError) {
          return errorResponse(availabilityError.message, availabilityError.status);
        }

        const prefix = `buckets/${bucketId}/`;
        const objects: { key: string; size: number; lastModified: string | null }[] = [];
        let scannedObjects = 0;
        let continuationToken: string | undefined;
        let hasMore = false;
        const seenTokens = new Set<string>();

        do {
          const page = await listB2Objects(
            env,
            prefix,
            Math.min(1000, 5000 - scannedObjects),
            continuationToken
          );
          scannedObjects += page.objects.length;
          for (const object of page.objects) {
            if (
              object.key.startsWith(prefix) &&
              !object.key.endsWith('/') &&
              !object.key.endsWith('.bzEmpty')
            ) {
              objects.push(object);
            }
          }

          hasMore = page.isTruncated;
          if (scannedObjects >= 5000) {
            if (hasMore) console.error('[bucket files] B2 listing capped at 5000 objects');
            break;
          }
          if (!hasMore) break;
          if (!page.nextContinuationToken || seenTokens.has(page.nextContinuationToken)) {
            throw new Error('B2 listing returned an invalid continuation token.');
          }
          continuationToken = page.nextContinuationToken;
          seenTokens.add(continuationToken);
        } while (hasMore);

        const rowsByKey = new Map<string, any>();
        for (let offset = 0; offset < objects.length; offset += 100) {
          const keys = objects.slice(offset, offset + 100).map((object) => object.key);
          const { data: rows, error: rowsError } = await supabase
            .from('bucket_files')
            .select('id, bucket_id, object_key, file_name, mime_type, checksum, uploaded_by, upload_status, created_at, updated_at')
            .eq('bucket_id', bucketId)
            .eq('upload_status', 'uploaded')
            .in('object_key', keys);

          if (rowsError) return errorResponse(rowsError.message, 500);
          for (const row of rows || []) rowsByKey.set(row.object_key, row);
        }

        const files = objects.map((object) => {
          const row = rowsByKey.get(object.key);
          const fileName = row?.file_name || fallbackFileName(object.key);
          const mimeType = row?.mime_type || guessMimeType(fileName);
          const lastModified = object.lastModified || row?.updated_at || row?.created_at || '';
          return {
            id: row?.id || encodeURIComponent(object.key),
            bucket_id: bucketId,
            file_name: fileName,
            object_key: object.key,
            mime_type: mimeType,
            file_size: object.size,
            checksum: row?.checksum ?? null,
            upload_status: 'uploaded',
            created_at: lastModified,
            updated_at: lastModified,
            uploaded_by: row?.uploaded_by ?? null,
            key: object.key,
            size: object.size,
            lastModified: object.lastModified,
          };
        });

        files.sort((a, b) => {
          const aTime = a.lastModified ? Date.parse(a.lastModified) : Number.NaN;
          const bTime = b.lastModified ? Date.parse(b.lastModified) : Number.NaN;
          if (Number.isNaN(aTime)) return Number.isNaN(bTime) ? 0 : 1;
          if (Number.isNaN(bTime)) return -1;
          return bTime - aTime;
        });

        return jsonResponse({ success: true, files }, 200, { 'Cache-Control': 'no-store' });
      }

      // ----------------------------------------------------------------------
      // 12. DELETE /files/:id - Idempotent Physical Deletion & Quota Release
      // ----------------------------------------------------------------------
      const deleteFileMatch = path.match(/^\/files\/(.+)$/);
      if (deleteFileMatch && request.method === 'DELETE') {
        const fileIdentifier = deleteFileMatch[1];
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const supabase = getSupabaseAdmin(env);

        // Fetch file to get bucket_id and object_key
        const { data: file } = await supabase
          .from('bucket_files')
          .select('id, bucket_id, object_key, file_name, upload_status')
          .eq('id', fileIdentifier)
          .maybeSingle();

        if (!file) {
          const objectKey = decodeObjectKey(fileIdentifier);
          const bucketId = objectKey ? bucketIdFromObjectKey(objectKey) : null;
          if (!objectKey || !bucketId || !objectKey.startsWith(`buckets/${bucketId}/`)) {
            return errorResponse('File not found.', 404);
          }

          const { isOwner, error: ownerError } = await verifyBucketAccess(
            supabase,
            bucketId,
            user.id,
            true
          );
          if (!isOwner || ownerError) {
            return errorResponse('Only the bucket owner can delete files.', 403);
          }

          try {
            await deleteB2Object(env, objectKey);
          } catch (b2Err: any) {
            return errorResponse(`Failed to delete object from Backblaze B2: ${b2Err.message}`, 502);
          }

          return jsonResponse({
            success: true,
            message: 'File deleted from Backblaze B2.',
            freedBytes: 0,
          });
        }

        // Only bucket owner can delete files
        const { isOwner, error: ownerError } = await verifyBucketAccess(
          supabase,
          file.bucket_id,
          user.id,
          true // requireOwner
        );

        if (!isOwner || ownerError) {
          return errorResponse('Only the bucket owner can delete files.', 403);
        }

        // 1. Physically delete from Backblaze B2 first
        try {
          await deleteB2Object(env, file.object_key);
        } catch (b2Err: any) {
          return errorResponse(`Failed to delete object from Backblaze B2: ${b2Err.message}`, 502);
        }

        // 2. Release quota and mark deleted in Supabase atomically
        const { data: deletedResult, error: dbError } = await supabase.rpc('delete_file_storage', {
          p_file_id: file.id,
        });

        if (dbError) {
          return errorResponse(`Object deleted from storage, but failed to update quota: ${dbError.message}`, 500);
        }

        return jsonResponse({
          success: true,
          message: 'File deleted from Backblaze B2 and quota released.',
          freedBytes: deletedResult?.freed_bytes ?? 0,
        });
      }

      // ----------------------------------------------------------------------
      // 13. POST /storage/reconcile - Storage Reconciliation Endpoint
      // ----------------------------------------------------------------------
      if (path === '/storage/reconcile' && request.method === 'POST') {
        const { user, error: authError } = await authenticateRequest(request, env);
        if (authError || !user) {
          return errorResponse(authError || 'Unauthorized', 401);
        }

        const supabase = getSupabaseAdmin(env);
        const { data, error } = await supabase.rpc('reconcile_storage_accounting');

        if (error) {
          return errorResponse(error.message, 500);
        }

        return jsonResponse(data);
      }

      return errorResponse(`Endpoint ${path} not found.`, 404);
    } catch (err: any) {
      return errorResponse(`Internal Worker Error: ${err.message || 'Unknown error'}`, 500);
    }
  },
};
