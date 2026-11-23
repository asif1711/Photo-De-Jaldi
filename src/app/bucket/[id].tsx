import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/theme/primitives';
import { tokens, type Tokens } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge, BadgeVariant } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { Input } from '@/components/common/Input';
import {
  deleteBucket,
  getBucketById,
  updateBucket,
} from '@/services/bucket';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  deleteFile,
  downloadFileToCache,
  finalizeUpload,
  getBucketFiles,
  getMultipartStatus,
  getStorageUsage,
  initiateMultipartUpload,
  getPartUploadUrl,
  uploadPart,
  uploadFileToB2,
  authorizeDownload,
  releaseCachedBlob,
  recordMultipartPart,
} from '@/services/storage';
import { Bucket } from '@/types';
import { formatBytes, formatDate, formatTimeRemaining } from '@/utils/formatters';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

interface ExpiryPreset {
  label: string;
  hours: number;
}

const EXTEND_PRESETS: ExpiryPreset[] = [
  { label: '+6 Hours', hours: 6 },
  { label: '+24 Hours (1 Day)', hours: 24 },
  { label: '+48 Hours (2 Days)', hours: 48 },
  { label: '+72 Hours (3 Days)', hours: 72 },
  { label: '+7 Days', hours: 168 },
];

// ─── Upload Status Type ───
type UploadStatus =
  | 'idle'
  | 'uploading'
  | 'paused'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface PartRecord {
  etag: string;
  size: number;
}

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

export default function BucketDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const colors = tokens.color;
  const styles = getStyles(colors);

  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Edit Modal State
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editExpiryDate, setEditExpiryDate] = useState<Date>(new Date());
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // File state
  const [files, setFiles] = useState<any[]>([]);
  const [filesLoading, setFilesLoading] = useState<boolean>(false);
  const [storageUsage, setStorageUsage] = useState<{
    total_bytes: number;
    committed_bytes: number;
    reserved_bytes: number;
    available_bytes: number;
    limit_bytes: number;
    utilization_percent: number;
  } | null>(null);

  // Upload UI state
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadedBytes, setUploadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [uploadSpeed, setUploadSpeed] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number>(0);
  const [currentPart, setCurrentPart] = useState<number>(0);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    uri: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);

  // Download state
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  // Refs for upload control (mutable across renders without triggering re-render)
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadPauseRef = useRef<boolean>(false);
  const uploadCancelRef = useRef<boolean>(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedFileRef = useRef<{
    uri: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const multipartStateRef = useRef<{
    multipartUploadId: string;
    uploadId: string;
    partSize: number;
    totalParts: number;
  } | null>(null);
  const completedPartsRef = useRef<Map<number, PartRecord>>(new Map());

  const fetchBucket = useCallback(
    async (isRefresh = false) => {
      if (!id) return;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMessage(null);

      const { data, error } = await getBucketById(id);

      if (error) {
        setErrorMessage(error);
        setBucket(null);
      } else {
        setBucket(data);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [id]
  );

  const fetchFiles = useCallback(async () => {
    if (!id) return;
    setFilesLoading(true);
    try {
      const fetched = await getBucketFiles(id);
      setFiles(fetched);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load files.');
    } finally {
      setFilesLoading(false);
    }
  }, [id]);

  const fetchStorageUsage = useCallback(async () => {
    try {
      const usage = await getStorageUsage();
      setStorageUsage(usage);
    } catch {
      // Non-fatal — storage indicator is informational
    }
  }, []);

  useEffect(() => {
    fetchBucket();
    fetchFiles();
    fetchStorageUsage();

    // Cleanup on unmount: cancel any in-progress upload
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchBucket, fetchFiles, fetchStorageUsage]);

  const isOwner = Boolean(user?.id && bucket?.created_by === user.id);

  const openEditModal = () => {
    if (!bucket) return;
    setEditName(bucket.name);
    setEditDescription(bucket.description || '');
    const currentExpiry = new Date(bucket.expires_at);
    const initialExpiry =
      currentExpiry.getTime() > Date.now()
        ? currentExpiry
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
    setEditExpiryDate(initialExpiry);
    setEditError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!bucket || savingEdit) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Bucket name cannot be empty.');
      return;
    }

    if (editExpiryDate.getTime() <= Date.now()) {
      setEditError('Expiry date must be in the future.');
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    const result = await updateBucket(bucket.id, {
      name: trimmedName,
      description: editDescription.trim() || null,
      expires_at: editExpiryDate.toISOString(),
    });

    setSavingEdit(false);

    if (result.error) {
      setEditError(result.error);
    } else if (result.data) {
      setBucket(result.data);
      setIsEditing(false);
      Alert.alert('Updated', 'Bucket details updated successfully.');
    }
  };

  const handleDeleteBucket = () => {
    if (!bucket) return;

    Alert.alert(
      'Delete Bucket',
      `Are you sure you want to permanently delete "${bucket.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteBucket(bucket.id);
            if (res.error) {
              Alert.alert('Error', res.error);
            } else {
              Alert.alert('Deleted', 'Bucket was removed.', [
                {
                  text: 'OK',
                  onPress: () => router.replace('/'),
                },
              ]);
            }
          },
        },
      ]
    );
  };

  // --- Upload flow ---

  const pickDocument = async () => {
    try {
      const pickerOptions = { type: '*/*', copyToCacheDirectory: true };
      console.log('[pickDocument] picker options:', pickerOptions);
      const result = await DocumentPicker.getDocumentAsync(pickerOptions);

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];

      // Verify the returned URI is readable before committing to state.
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      if (!fileInfo.exists) {
        setUploadError('Selected file is not readable. Please try again.');
        return;
      }

      setUploadError(null);
      setSelectedFile({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
        size: asset.size || 0,
      });
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to pick file.');
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadStatus('idle');
    selectedFileRef.current = null;
    multipartStateRef.current = null;
    completedPartsRef.current = new Map();
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const uploadPartWithRetry = async (
    partNumber: number,
    partSize: number,
    startByte: number,
    endByte: number,
    mimeType: string
  ): Promise<{ etag: string; size: number } | null> => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (uploadCancelRef.current) return null;

      // Wait while paused
      while (uploadPauseRef.current && !uploadCancelRef.current) {
        setUploadStatus('paused');
        await sleep(500);
      }

      if (uploadCancelRef.current) return null;

      try {
        if (attempt > 0) {
          setUploadStatus('retrying');
          setRetryCount(attempt);
        } else {
          setUploadStatus('uploading');
        }

        // Get presigned URL for this part
        const partUrl = await getPartUploadUrl(
          multipartStateRef.current!.multipartUploadId,
          partNumber
        );

        // Upload the part
        const result = await uploadPart(
          partUrl.uploadUrl,
          selectedFileRef.current!.uri,
          partNumber,
          startByte,
          endByte,
          mimeType
        );

        // Record the part in Supabase so the session moves from 'initiated' to 'uploading'
        await recordMultipartPart(
          multipartStateRef.current!.multipartUploadId,
          partNumber,
          result.etag,
          endByte - startByte
        );

        setRetryCount(0);
        return { etag: result.etag, size: endByte - startByte };
      } catch (err: any) {
        if (uploadCancelRef.current) return null;

        // Fail immediately on non-retryable errors (file/permission, 4xx)
        if (err.retryable === false) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          setUploadStatus('retrying');
          await sleep(delay);
        } else {
          throw err;
        }
      }
    }
    return null;
  };

  const handleUpload = async () => {
    if (!selectedFile || !bucket || !id) return;

    // Client-side 5 GB per-file limit check (server also enforces this)
    const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(
        `File exceeds maximum size of 5 GB (${formatBytes(selectedFile.size)}).`
      );
      setUploadStatus('failed');
      return;
    }

    // Capture file in ref for stable access during upload
    selectedFileRef.current = selectedFile;
    completedPartsRef.current = new Map();

    // Reset UI state
    setUploadStatus('uploading');
    setUploadProgress(0);
    setUploadedBytes(0);
    setTotalBytes(selectedFile.size);
    setUploadSpeed(0);
    setEtaSeconds(0);
    setCurrentPart(0);
    setRetryCount(0);
    setUploadError(null);
    setIsPaused(false);
    uploadPauseRef.current = false;
    uploadCancelRef.current = false;

    abortControllerRef.current = new AbortController();

    const startTime = Date.now();
    let lastProgressTime = startTime;
    let lastProgressBytes = 0;
    // Tracks whether the failure happened at the /complete step so the catch
    // block can keep the session resumable instead of aborting it.
    let completeAttempted = false;

    try {
      // 1. Initiate multipart upload (reserves quota, gets UploadId)
      const initiation = await initiateMultipartUpload(
        id,
        selectedFile.name,
        selectedFile.size,
        selectedFile.type
      );

      if (uploadCancelRef.current) {
        // Clean up reservation if canceled before starting
        await abortUploadReservation(initiation.reservationId);
        setUploadStatus('cancelled');
        return;
      }

      multipartStateRef.current = {
        multipartUploadId: initiation.multipartUploadId,
        uploadId: initiation.uploadId,
        partSize: initiation.partSize,
        totalParts: initiation.totalParts,
      };

      // 2. Upload each part sequentially
      for (let partNum = 1; partNum <= initiation.totalParts; partNum++) {
        if (uploadCancelRef.current) {
          setUploadStatus('cancelled');
          break;
        }

        const startByte = (partNum - 1) * initiation.partSize;
        const endByte = Math.min(startByte + initiation.partSize, selectedFile.size);

        const partResult = await uploadPartWithRetry(
          partNum,
          initiation.partSize,
          startByte,
          endByte,
          selectedFile.type
        );

        if (uploadCancelRef.current) {
          setUploadStatus('cancelled');
          break;
        }

        if (partResult) {
          completedPartsRef.current.set(partNum, {
            etag: partResult.etag,
            size: partResult.size,
          });

          const newUploadedBytes = Math.min(
            uploadedBytes + partResult.size,
            selectedFile.size
          );
          setUploadedBytes(newUploadedBytes);

          const progress = Math.round((newUploadedBytes / selectedFile.size) * 100);
          setUploadProgress(progress);
          setCurrentPart(partNum);

          // Calculate speed and ETA
          const now = Date.now();
          const elapsed = (now - lastProgressTime) / 1000;
          if (elapsed > 0) {
            const bytesSinceLast = newUploadedBytes - lastProgressBytes;
            const speed = bytesSinceLast / elapsed;
            setUploadSpeed(speed);
            const remainingBytes = selectedFile.size - newUploadedBytes;
            setEtaSeconds(speed > 0 ? Math.ceil(remainingBytes / speed) : 0);
          }
          lastProgressTime = now;
          lastProgressBytes = newUploadedBytes;
        }
      }

      // 3. Complete if all parts done and not canceled
      if (!uploadCancelRef.current && completedPartsRef.current.size === initiation.totalParts) {
        setUploadStatus('completed');

        const partsArray = Array.from(completedPartsRef.current.entries()).map(
          ([partNum, part]) => ({ partNumber: partNum, etag: part.etag })
        );

        completeAttempted = true;
        await completeMultipartUpload(
          initiation.multipartUploadId,
          partsArray
        );

        setUploadProgress(100);
        setUploadStatus('completed');

        // Release cached blob for this upload session
        const uploadUri = selectedFileRef.current?.uri;
        if (uploadUri) {
          releaseCachedBlob(uploadUri);
        }

        // Refresh
        setSelectedFile(null);
        selectedFileRef.current = null;
        multipartStateRef.current = null;
        completedPartsRef.current = new Map();

        await fetchFiles();
        await fetchStorageUsage();
        Alert.alert('Success', 'File uploaded successfully.');
      } else if (!uploadCancelRef.current) {
        // Some parts missing — this shouldn't happen if all parts uploaded
        throw new Error('Not all parts were uploaded successfully.');
      }
    } catch (err: any) {
      // Release cached blob on upload failure
      const uploadUri = selectedFileRef.current?.uri;
      if (uploadUri) {
        releaseCachedBlob(uploadUri);
      }

      // Abort only on non-retryable errors. A retryable failure at the /complete
      // step (5xx or network) keeps the session intact so Retry calls /complete
      // again — the Worker is now idempotent.
      const state = multipartStateRef.current;
      const allPartsDone = state && completedPartsRef.current.size === state.totalParts;
      const retryable = err?.retryable !== false;
      const shouldAbort =
        !uploadCancelRef.current &&
        !!state &&
        (!retryable || (allPartsDone && !completeAttempted));

      if (shouldAbort && state) {
        try {
          await abortMultipartUpload(state.multipartUploadId);
        } catch {
          // Ignore — server-side cleanup will handle expired sessions
        }
        // Clear state so Retry starts a brand-new upload from the selected file
        multipartStateRef.current = null;
        completedPartsRef.current = new Map();
      }

      if (uploadCancelRef.current) {
        setUploadStatus('cancelled');
      } else {
        setUploadStatus('failed');
        const msg = err?.message || 'Upload failed.';
        setUploadError(msg);
        Alert.alert('Upload Failed', msg);
      }
    } finally {
      // Cleanup refs
      abortControllerRef.current = null;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    }
  };

  const abortUploadReservation = async (reservationId: string) => {
    try {
      // Best-effort: release quota via single-upload abort endpoint
      await fetch(`${process.env.EXPO_PUBLIC_API_URL}/uploads/abort`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${(await (globalThis as any).supabase?.auth?.getSession?.())?.session?.access_token || ''}`,
        },
        body: JSON.stringify({ reservationId }),
      });
    } catch {
      // Ignore — reservation will expire naturally
    }
  };

  const handlePause = () => {
    uploadPauseRef.current = true;
    setIsPaused(true);
    if (uploadStatus === 'uploading') {
      setUploadStatus('paused');
    }
  };

  const handleResume = () => {
    uploadPauseRef.current = false;
    setIsPaused(false);
    setUploadStatus('uploading');
    // Resume the upload loop — the running handleUpload will pick up
    void handleUpload();
  };

  const handleCancelUpload = async () => {
    uploadCancelRef.current = true;
    uploadPauseRef.current = false;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    setUploadStatus('cancelled');
    setIsPaused(false);

    // Abort multipart upload on server if we have one
    if (multipartStateRef.current) {
      try {
        await abortMultipartUpload(multipartStateRef.current.multipartUploadId);
      } catch {
        // Ignore — server-side cleanup will handle expired sessions
      }
    }

    // Reset UI state
    const cancelUri = selectedFileRef.current?.uri;
    if (cancelUri) {
      releaseCachedBlob(cancelUri);
    }
    setSelectedFile(null);
    selectedFileRef.current = null;
    multipartStateRef.current = null;
    completedPartsRef.current = new Map();
    setUploadProgress(0);
    setUploadedBytes(0);
    setTotalBytes(0);
    setUploadSpeed(0);
    setEtaSeconds(0);
    setCurrentPart(0);
    setRetryCount(0);
    setUploadError(null);
  };

  // Retry after failure: restart from where we left off
  const handleRetry = async () => {
    if (!selectedFileRef.current || !multipartStateRef.current) return;

    setUploadError(null);
    setUploadStatus('uploading');
    setRetryCount(0);

    const file = selectedFileRef.current;
    const state = multipartStateRef.current;

    const startTime = Date.now();
    let lastProgressTime = startTime;
    let lastProgressBytes = 0;
    // Tracks whether the failure happened at the /complete step so the catch
    // block can keep the session resumable instead of aborting it.
    let completeAttempted = false;

    try {
      // Resume from current state: get server status to verify session
      const serverStatus = await getMultipartStatus(state.multipartUploadId);

      if (serverStatus.status === 'expired') {
        throw new Error('Upload session has expired. Please start a new upload.');
      }

      // Sync completed parts from server
      const serverParts = new Map<number, PartRecord>();
      serverStatus.parts.forEach((p) => {
        serverParts.set(p.partNumber, { etag: p.etag, size: p.partSize });
      });
      completedPartsRef.current = serverParts;
      setUploadedBytes(serverStatus.uploadedBytes);
      setUploadProgress(
        Math.round((serverStatus.uploadedBytes / file.size) * 100)
      );

      // Continue uploading remaining parts
      for (let partNum = 1; partNum <= state.totalParts; partNum++) {
        if (uploadCancelRef.current) {
          setUploadStatus('cancelled');
          break;
        }

        while (uploadPauseRef.current && !uploadCancelRef.current) {
          setUploadStatus('paused');
          await sleep(500);
        }

        if (uploadCancelRef.current) {
          setUploadStatus('cancelled');
          break;
        }

        // Skip already-completed parts
        if (completedPartsRef.current.has(partNum)) {
          continue;
        }

        const startByte = (partNum - 1) * state.partSize;
        const endByte = Math.min(startByte + state.partSize, file.size);

        const partResult = await uploadPartWithRetry(
          partNum,
          state.partSize,
          startByte,
          endByte,
          file.type
        );

        if (uploadCancelRef.current) {
          setUploadStatus('cancelled');
          break;
        }

        if (partResult) {
          completedPartsRef.current.set(partNum, {
            etag: partResult.etag,
            size: partResult.size,
          });

          const newUploadedBytes = Math.min(
            uploadedBytes + partResult.size,
            file.size
          );
          setUploadedBytes(newUploadedBytes);

          const progress = Math.round((newUploadedBytes / file.size) * 100);
          setUploadProgress(progress);
          setCurrentPart(partNum);

          const now = Date.now();
          const elapsed = (now - lastProgressTime) / 1000;
          if (elapsed > 0) {
            const bytesSinceLast = newUploadedBytes - lastProgressBytes;
            const speed = bytesSinceLast / elapsed;
            setUploadSpeed(speed);
            const remainingBytes = file.size - newUploadedBytes;
            setEtaSeconds(speed > 0 ? Math.ceil(remainingBytes / speed) : 0);
          }
          lastProgressTime = now;
          lastProgressBytes = newUploadedBytes;
        }
      }

      if (!uploadCancelRef.current && completedPartsRef.current.size === state.totalParts) {
        setUploadStatus('completed');

        const partsArray = Array.from(completedPartsRef.current.entries()).map(
          ([partNum, part]) => ({ partNumber: partNum, etag: part.etag })
        );

        completeAttempted = true;
        await completeMultipartUpload(state.multipartUploadId, partsArray);

        setUploadProgress(100);
        setUploadStatus('completed');

        setSelectedFile(null);
        selectedFileRef.current = null;
        multipartStateRef.current = null;
        completedPartsRef.current = new Map();
        await fetchFiles();
        await fetchStorageUsage();
        Alert.alert('Success', 'File uploaded successfully.');
      }
    } catch (err: any) {
      // Release cached blob on final retry failure
      const retryUri = selectedFileRef.current?.uri;
      if (retryUri) {
        releaseCachedBlob(retryUri);
      }

      // Abort only on non-retryable errors. A retryable failure at the /complete
      // step (5xx or network) keeps the session intact so Retry calls /complete
      // again — the Worker is now idempotent.
      const state = multipartStateRef.current;
      const allPartsDone = state && completedPartsRef.current.size === state.totalParts;
      const retryable = err?.retryable !== false;
      const shouldAbort =
        !!state && (!retryable || (allPartsDone && !completeAttempted));

      if (shouldAbort && state) {
        try {
          await abortMultipartUpload(state.multipartUploadId);
        } catch {
          // Ignore — server-side cleanup will handle expired sessions
        }
        // Clear state so next attempt starts fresh
        multipartStateRef.current = null;
        completedPartsRef.current = new Map();
      }

      setUploadStatus('failed');
      const msg = err?.message || 'Retry failed.';
      setUploadError(msg);
      Alert.alert('Retry Failed', msg);
    }
  };

  // --- Download flow ---

  const handleDownload = async (file: any) => {
    if (!file || downloadingFileId === file.id) return;
    setDownloadingFileId(file.id);
    setDownloadProgress((prev) => ({ ...prev, [file.id]: 0 }));

    try {
      const result = await authorizeDownload(file.id);
      setDownloadProgress((prev) => ({ ...prev, [file.id]: 10 }));

      const localUri = await downloadFileToCache(
        result.downloadUrl,
        result.fileName,
        (progress) => {
          setDownloadProgress((prev) => ({
            ...prev,
            [file.id]: Math.round(progress * 100),
          }));
        }
      );

      setDownloadProgress((prev) => ({ ...prev, [file.id]: 100 }));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localUri, { dialogTitle: 'Save File' });
      } else {
        Alert.alert('Downloaded', `File saved to ${localUri}`);
      }
    } catch (err: any) {
      setDownloadProgress((prev) => {
        const { [file.id]: _removed, ...rest } = prev;
        return rest;
      });
      Alert.alert('Download Failed', err?.message || 'Failed to download file.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  // --- Delete flow ---

  const handleDeleteFile = async (file: any) => {
    if (!file) return;

    Alert.alert(
      'Delete File',
      `Are you sure you want to delete "${file.file_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFile(file.id);
              await fetchFiles();
              await fetchStorageUsage();
              Alert.alert('Deleted', 'File removed from bucket.');
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Failed to delete file.');
            }
          },
        },
      ]
    );
  };

  const getStatusVariant = (status: string): BadgeVariant => {
    switch (status) {
      case 'active':
        return 'active';
      case 'completed':
        return 'completed';
      case 'expired':
        return 'expired';
      default:
        return 'neutral';
    }
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
    if (bytesPerSecond < 1024 * 1024)
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatETA = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: bucket ? bucket.name : 'Bucket Details',
          headerBackTitle: 'Back',
        }}
      />

      <ScrollView
        style={[styles.container, { backgroundColor: tokens.color.bg }]}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              fetchBucket(true);
              fetchFiles();
              fetchStorageUsage();
            }}
            tintColor={tokens.color.primaryText}
            colors={[tokens.color.primaryText]}
          />
        }>
        {/* Loading State */}
        {loading && !refreshing && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={tokens.color.primaryText} />
            <Text style={[styles.statusText, { color: tokens.color.textMuted }]}>
              Loading bucket details…
            </Text>
          </View>
        )}

        {/* Error / Unauthorized State */}
        {!loading && (errorMessage || !bucket) && (
          <Card style={styles.errorCard}>
            <View style={styles.errorRow}>
              <Ionicons name="lock-closed-outline" size={36} color={tokens.color.danger} />
              <View style={styles.errorTextContainer}>
                <Text style={[styles.errorTitle, { color: tokens.color.text }]}>Access Restricted</Text>
                <Text style={[styles.errorDescription, { color: tokens.color.textMuted }]}>
                  {errorMessage ||
                    'You are not authorized to view this bucket, or it does not exist.'}
                </Text>
              </View>
            </View>
            <Button
              title="Return to Home"
              variant="primary"
              onPress={() => router.replace('/')}
              style={styles.backButton}
              icon={<Ionicons name="arrow-back" size={16} color={tokens.color.onPrimary} />}
            />
          </Card>
        )}

        {/* Real Bucket Data */}
        {!loading && bucket && (
          <>
            {/* Header / Identification Card */}
            <Card style={styles.mainCard}>
              <View style={styles.headerRow}>
                <View style={styles.titleContainer}>
                  <Text style={[styles.bucketTitle, { color: tokens.color.text }]}>{bucket.name}</Text>
                  <Text style={[styles.bucketId, { color: tokens.color.textMuted }]}>ID: {bucket.id}</Text>
                </View>
                <Badge label={bucket.status} variant={getStatusVariant(bucket.status)} />
              </View>

              {bucket.description ? (
                <Text style={[styles.descriptionText, { color: tokens.color.textMuted }]}>
                  {bucket.description}
                </Text>
              ) : null}

              {/* Status and Expiry Tracker */}
              <View style={[styles.statusBox, { backgroundColor: tokens.color.surfaceRaised }]}>
                <View style={styles.statusRow}>
                  <Ionicons name="calendar-outline" size={16} color={tokens.color.info} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Created: <Text style={{ color: tokens.color.text }}>{formatDate(bucket.created_at)}</Text>
                  </Text>
                </View>

                <View style={styles.statusRow}>
                  <Ionicons name="timer-outline" size={16} color={tokens.color.warning} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Expires:{' '}
                    <Text style={{ color: tokens.color.text, fontWeight: '600' }}>
                      {formatDate(bucket.expires_at)} ({formatTimeRemaining(bucket.expires_at)})
                    </Text>
                  </Text>
                </View>

                <View style={styles.statusRow}>
                  <Ionicons name="person-outline" size={16} color={tokens.color.textMuted} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Owner:{' '}
                    <Text style={{ color: tokens.color.text, fontWeight: isOwner ? '700' : '500' }}>
                      {isOwner ? 'You (Creator)' : bucket.created_by}
                    </Text>
                  </Text>
                </View>

                <View style={styles.statusRow}>
                  <Ionicons name="sync-outline" size={16} color={tokens.color.textMuted} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Last updated: {formatDate(bucket.updated_at)}
                  </Text>
                </View>
              </View>

              {/* Owner Actions */}
              {isOwner && (
                <View style={styles.ownerActionsRow}>
                  <Button
                    title="Edit Bucket"
                    variant="outline"
                    onPress={openEditModal}
                    icon={<Ionicons name="create-outline" size={16} color={tokens.color.text} />}
                    style={styles.actionBtn}
                  />
                  <Button
                    title="Delete"
                    variant="danger"
                    onPress={handleDeleteBucket}
                    icon={<Ionicons name="trash-outline" size={16} color={tokens.color.danger} />}
                    style={styles.actionBtn}
                  />
                </View>
              )}
            </Card>

            {/* Global Storage Indicator */}
            <Card variant="subtle" style={styles.storageCard}>
              <View style={styles.storageHeader}>
                <Ionicons name="cloud-outline" size={20} color={tokens.color.info} />
                <Text style={[styles.storageTitle, { color: tokens.color.text }]}>Global Storage</Text>
              </View>
              {storageUsage ? (
                <View style={styles.storageRow}>
                  <View style={styles.storageProgressContainer}>
                    <View
                      style={[
                        styles.storageProgressBar,
                        {
                          width: Math.min(
                            (storageUsage.utilization_percent || 0) / 100,
                            1
                          ),
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.storageStats}>
                    <Text style={[styles.storageUsed, { color: tokens.color.text }]}>
                      {formatBytes(storageUsage.committed_bytes)} used
                    </Text>
                    <Text style={[styles.storageAvailable, { color: tokens.color.textMuted }]}>
                      {formatBytes(storageUsage.available_bytes)} of {formatBytes(
                        storageUsage.limit_bytes
                      )} available
                    </Text>
                    <Text style={[styles.storagePercent, { color: tokens.color.textMuted }]}>
                      {(storageUsage.utilization_percent || 0).toFixed(1)}% of 9 GB
                    </Text>
                  </View>
                </View>
              ) : (
                <ActivityIndicator size="small" color={tokens.color.primaryText} />
              )}
            </Card>

            {/* Files Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Shared Files</Text>
              <Badge label={filesLoading ? 'Loading' : 'Files'} variant="neutral" />
            </View>

            {/* Upload Controls */}
            <View style={styles.uploadControls}>
              {selectedFile && (
                <View style={styles.selectedFileCard}>
                  <Ionicons name="document-outline" size={24} color={tokens.color.info} />
                  <View style={styles.selectedFileInfo}>
                    <Text style={[styles.selectedFileName, { color: tokens.color.text }]}>
                      {selectedFile.name}
                    </Text>
                    <Text style={[styles.selectedFileSize, { color: tokens.color.textMuted }]}>
                      {formatBytes(selectedFile.size)}
                    </Text>
                  </View>
                  <Button
                    title="Cancel Selection"
                    variant="outline"
                    onPress={clearSelectedFile}
                    icon={<Ionicons name="close-outline" size={16} color={tokens.color.text} />}
                    style={styles.clearFileButton}
                  />
                </View>
              )}

              <Button
                title={selectedFile ? 'Start Upload' : 'Upload File'}
                variant="primary"
                onPress={selectedFile ? handleUpload : pickDocument}
                disabled={
                  uploadStatus !== 'idle' &&
                  uploadStatus !== 'failed' &&
                  uploadStatus !== 'cancelled'
                }
                loading={uploadStatus === 'uploading'}
                icon={
                  <Ionicons
                    name={
                      selectedFile
                        ? 'cloud-upload-outline'
                        : 'document-outline'
                    }
                    size={18}
                    color={tokens.color.onPrimary}
                  />
                }
                style={styles.uploadButton}
              />
            </View>

            {/* Upload Progress / Control Card */}
            {uploadStatus !== 'idle' && selectedFile && (
              <Card variant="subtle" style={styles.uploadProgressCard}>
                <View style={styles.uploadProgressHeader}>
                  <Ionicons
                    name={
                      uploadStatus === 'paused'
                        ? 'pause-outline'
                        : uploadStatus === 'retrying'
                        ? 'refresh-outline'
                        : uploadStatus === 'failed'
                        ? 'alert-circle-outline'
                        : uploadStatus === 'cancelled'
                        ? 'trash-outline'
                        : 'cloud-upload-outline'
                    }
                    size={20}
                    color={
                      uploadStatus === 'failed' || uploadStatus === 'cancelled'
                        ? tokens.color.danger
                        : uploadStatus === 'paused'
                        ? tokens.color.textMuted
                        : tokens.color.info
                    }
                  />
                  <Text style={[styles.uploadProgressTitle, { color: tokens.color.text }]}>
                    {uploadStatus === 'paused' ? 'Paused' : uploadStatus === 'retrying' ? 'Retrying…' : uploadStatus === 'failed' ? 'Failed' : uploadStatus === 'cancelled' ? 'Cancelled' : 'Uploading…'}
                  </Text>
                </View>

                <View style={styles.uploadProgressContainer}>
                  <View style={styles.uploadProgressBarOuter}>
                    <View
                      style={[
                        styles.uploadProgressBarInner,
                        { width: uploadProgress },
                      ]}
                    />
                  </View>
                  <View style={styles.uploadProgressInfo}>
                    <Text style={[styles.uploadProgressPercent, { color: tokens.color.textMuted }]}>
                      {uploadProgress}%
                    </Text>
                    <Text style={[styles.uploadProgressDetail, { color: tokens.color.textMuted }]}>
                      {formatBytes(uploadedBytes)} of {formatBytes(totalBytes)}
                    </Text>
                  </View>
                </View>

                {uploadSpeed > 0 && (
                  <View style={styles.uploadSpeedRow}>
                    <Ionicons name="speedometer-outline" size={14} color={tokens.color.textMuted} />
                    <Text style={[styles.uploadSpeedText, { color: tokens.color.textMuted }]}>
                      {formatSpeed(uploadSpeed)}
                    </Text>
                    {etaSeconds > 0 && (
                      <Text style={[styles.uploadSpeedText, { color: tokens.color.textMuted }]}>
                        • ETA {formatETA(etaSeconds)}
                      </Text>
                    )}
                    {retryCount > 0 && (
                      <Text style={[styles.uploadSpeedText, { color: tokens.color.textMuted }]}>
                        • Retry {retryCount}/{MAX_RETRIES}
                      </Text>
                    )}
                    {currentPart > 0 && (
                      <Text style={[styles.uploadSpeedText, { color: tokens.color.textMuted }]}>
                        • Part {currentPart}
                      </Text>
                    )}
                  </View>
                )}

                {uploadError && (
                  <View style={styles.uploadErrorBanner}>
                    <Ionicons name="alert-circle-outline" size={18} color={tokens.color.danger} />
                    <Text style={[styles.uploadErrorText, { color: tokens.color.danger }]}>
                      {uploadError}
                    </Text>
                  </View>
                )}

                <View style={styles.uploadActionRow}>
                  {uploadStatus === 'paused' ? (
                    <>
                      <Button
                        title="Resume"
                        variant="primary"
                        onPress={handleResume}
                        style={styles.resumeButton}
                      />
                      <Button
                        title="Cancel"
                        variant="danger"
                        onPress={handleCancelUpload}
                        style={styles.cancelUploadButton}
                      />
                    </>
                  ) : uploadStatus === 'failed' ? (
                    <>
                      <Button
                        title="Retry"
                        variant="outline"
                        onPress={handleRetry}
                        disabled={retryCount >= MAX_RETRIES}
                        style={styles.retryButton}
                      />
                      <Button
                        title="Cancel"
                        variant="danger"
                        onPress={handleCancelUpload}
                        style={styles.cancelUploadButton}
                      />
                    </>
                  ) : uploadStatus === 'cancelled' ? (
                    <Button
                      title="Dismiss"
                      variant="outline"
                      onPress={clearSelectedFile}
                      style={styles.dismissButton}
                    />
                  ) : (
                    <>
                      <Button
                        title="Pause"
                        variant="outline"
                        onPress={handlePause}
                        style={styles.pauseButton}
                      />
                      <Button
                        title="Cancel"
                        variant="danger"
                        onPress={handleCancelUpload}
                        style={styles.cancelUploadButton}
                      />
                    </>
                  )}
                </View>
              </Card>
            )}

            {/* File List */}
            {filesLoading && files.length === 0 && (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={tokens.color.primaryText} />
                <Text style={[styles.statusText, { color: tokens.color.textMuted }]}>
                  Loading files…
                </Text>
              </View>
            )}

            {!filesLoading && files.length === 0 && (
              <Card variant="subtle" style={styles.filesCard}>
                <EmptyState
                  icon={<Ionicons name="cloud-upload-outline" size={36} color={tokens.color.info} />}
                  title="No Files Uploaded Yet"
                  description="Select a file and tap Upload File to add it to this bucket."
                  action={
                    <Button
                      title={selectedFile ? 'Start Upload' : 'Upload File'}
                      variant="primary"
                      onPress={selectedFile ? handleUpload : pickDocument}
                      disabled={
                        uploadStatus !== 'idle' &&
                        uploadStatus !== 'failed' &&
                        uploadStatus !== 'cancelled'
                      }
                      loading={uploadStatus === 'uploading'}
                      icon={
                        <Ionicons
                          name={
                            selectedFile
                              ? 'cloud-upload-outline'
                              : 'document-outline'
                          }
                          size={16}
                          color={tokens.color.onPrimary}
                        />
                      }
                      style={styles.emptyUploadButton}
                    />
                  }
                />
              </Card>
            )}

            {!filesLoading && files.length > 0 && (
              <View style={styles.fileList}>
                {files.map((file) => {
                  const isDownloading = downloadingFileId === file.id;
                  const progress = downloadProgress[file.id] || 0;
                  return (
                    <Card
                      key={file.id}
                      style={styles.fileCard}
                      variant={isOwner ? 'default' : 'subtle'}
                    >
                      <View style={styles.fileRow}>
                        <View style={styles.fileInfo}>
                          <Ionicons
                            name="document-outline"
                            size={32}
                            color={tokens.color.textMuted}
                          />
                          <View style={styles.fileMeta}>
                            <Text style={[styles.fileName, { color: tokens.color.text }]}>
                              {file.file_name}
                            </Text>
                            <Text style={[styles.fileType, { color: tokens.color.textMuted }]}>
                              {file.mime_type} • {formatBytes(file.file_size)}
                            </Text>
                            <Text style={[styles.fileDate, { color: tokens.color.textMuted }]}>
                              {formatDate(file.created_at)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.fileActions}>
                          {isDownloading ? (
                            <View style={styles.downloadProgressContainer}>
                              <View style={styles.downloadProgressBarOuter}>
                                <View
                                  style={[
                                    styles.downloadProgressBarInner,
                                    { width: progress },
                                  ]}
                                />
                              </View>
                              <Text style={[styles.downloadProgressText, { color: tokens.color.textMuted }]}>
                                {progress}%
                              </Text>
                            </View>
                          ) : (
                            <Button
                              title="Download"
                              variant="outline"
                              onPress={() => handleDownload(file)}
                              icon={<Ionicons name="arrow-down-outline" size={16} color={tokens.color.info} />}
                              style={styles.downloadButton}
                            />
                          )}
                          {isOwner && (
                            <Button
                              title="Delete"
                              variant="danger"
                              onPress={() => handleDeleteFile(file)}
                              icon={<Ionicons name="trash-outline" size={16} color={tokens.color.danger} />}
                              style={styles.deleteFileButton}
                            />
                          )}
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Edit Bucket Modal */}
      <Modal visible={isEditing} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: tokens.color.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: tokens.color.text }]}>Edit Bucket</Text>
              <TouchableOpacity onPress={() => setIsEditing(false)}>
                <Ionicons name="close" size={24} color={tokens.color.textMuted} />
              </TouchableOpacity>
            </View>

            {editError && (
              <View style={[styles.errorBanner, { backgroundColor: tokens.color.dangerSoft }]}>
                <Ionicons name="alert-circle" size={18} color={tokens.color.danger} />
                <Text style={[styles.errorBannerText, { color: tokens.color.danger }]}>{editError}</Text>
              </View>
            )}

            <Input
              label="Bucket Name *"
              value={editName}
              onChangeText={setEditName}
              placeholder="Bucket Name"
            />

            <Input
              label="Description (Optional)"
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Description"
              multiline
              numberOfLines={3}
              style={{ height: 60 }}
            />

            {/* Expiry Extension */}
            <View style={styles.modalExpirySection}>
              <Text style={[styles.fieldLabel, { color: tokens.color.textMuted }]}>Extend Expiry Date</Text>
              <Text style={[styles.expiryPreview, { color: tokens.color.info }]}>
                New expiry: {formatDate(editExpiryDate.toISOString())}
              </Text>
              <View style={styles.presetButtonsRow}>
                {EXTEND_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={preset.hours}
                    onPress={() => setEditExpiryDate(new Date(Date.now() + preset.hours * 3600 * 1000))}
                    style={[styles.smallChip, { borderColor: tokens.color.border, backgroundColor: tokens.color.surfaceRaised }]}>
                    <Text style={[styles.smallChipText, { color: tokens.color.text }]}>{preset.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalButtonsRow}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setIsEditing(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Save Changes"
                variant="primary"
                loading={savingEdit}
                disabled={savingEdit}
                onPress={handleSaveEdit}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const getStyles = (colors: Tokens['color']) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  centerContainer: {
    paddingVertical: Spacing.xxxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: Typography.size.sm,
    marginTop: Spacing.sm,
  },
  errorCard: {
    padding: Spacing.xl,
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  errorDescription: {
    fontSize: Typography.size.sm,
    marginTop: 4,
    lineHeight: 18,
  },
  backButton: {
    width: '100%',
  },
  mainCard: {
    marginBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  titleContainer: {
    flex: 1,
    marginRight: Spacing.md,
  },
  bucketTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
  },
  bucketId: {
    fontSize: Typography.size.xs,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  descriptionText: {
    fontSize: Typography.size.sm,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  statusBox: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusLabel: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  ownerActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionBtn: {
    flex: 1,
  },
  storageCard: {
    marginBottom: Spacing.lg,
  },
  storageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  storageTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    color: tokens.color.text,
  },
  storageRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  storageProgressContainer: {
    flex: 1,
    alignItems: 'center',
  },
  storageProgressBar: {
    height: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: tokens.color.primary,
  },
  storageStats: {
    flex: 2,
  },
  storageUsed: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    color: tokens.color.text,
  },
  storageAvailable: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: 2,
  },
  storagePercent: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  uploadControls: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  selectedFileCard: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: tokens.color.primarySoft,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: tokens.color.primary,
  },
  selectedFileInfo: {
    flex: 1,
  },
  selectedFileName: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: tokens.color.text,
  },
  selectedFileSize: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: 2,
  },
  clearFileButton: {
    paddingHorizontal: Spacing.sm,
  },
  uploadButton: {
    flex: 1,
  },
  uploadProgressCard: {
    marginBottom: Spacing.lg,
  },
  uploadProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  uploadProgressTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: tokens.color.text,
  },
  uploadProgressContainer: {
    gap: Spacing.xs,
  },
  uploadProgressBarOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.color.surfaceRaised,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    height: 8,
  },
  uploadProgressBarInner: {
    height: 8,
    backgroundColor: tokens.color.primary,
  },
  uploadProgressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  uploadProgressPercent: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
  },
  uploadProgressDetail: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
  },
  uploadSpeedRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  uploadSpeedText: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
  },
  uploadErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: tokens.color.dangerSoft,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  uploadErrorText: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  uploadActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  resumeButton: {
    flex: 1,
  },
  pauseButton: {
    flex: 1,
  },
  retryButton: {
    flex: 1,
  },
  cancelUploadButton: {
    flex: 1,
  },
  dismissButton: {
    width: '100%',
  },
  filesCard: {
    marginBottom: Spacing.lg,
  },
  fileList: {
    gap: Spacing.md,
  },
  fileCard: {
    marginBottom: 0,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  fileInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  fileMeta: {
    flex: 1,
  },
  fileName: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: tokens.color.text,
  },
  fileType: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: 2,
  },
  fileDate: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: 2,
  },
  fileActions: {
    gap: Spacing.sm,
  },
  downloadButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  deleteFileButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  downloadProgressContainer: {
    gap: Spacing.xs,
  },
  downloadProgressBarOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.color.surfaceRaised,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    height: 6,
    width: 80,
  },
  downloadProgressBarInner: {
    height: 6,
    backgroundColor: tokens.color.primary,
  },
  downloadProgressText: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
  },
  emptyUploadButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  errorBannerText: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  modalExpirySection: {
    marginBottom: Spacing.lg,
  },
  fieldLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    marginBottom: 4,
  },
  expiryPreview: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    marginBottom: Spacing.sm,
  },
  presetButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  smallChip: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  smallChipText: {
    fontSize: Typography.size.xs,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
});
