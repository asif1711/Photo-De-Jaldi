import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type HostInstance,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { FileTypeIcon } from '@/theme/components';
import { APP_LIMITS, WEB_MAX_FILE_SIZE_BYTES } from '@/constants/caps';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  getMultipartStatus,
  getPartUploadUrl,
  initiateMultipartUpload,
  recordMultipartPart,
  releaseCachedBlob,
  uploadPart,
  uploadWebPart,
  type InitiateMultipartResult,
} from '@/services/storage';
import { formatBytes } from '@/utils/formatters';
import { getMultipartPartRange, getMultipartPartSlice } from '@/utils/multipart';
import { showAlert } from '@/utils/alert';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

const WEB_UPLOAD_LIMIT_MESSAGE =
  "Files over 100 MB can't be uploaded from the browser. Use the Android app for larger files.";
const WEB_UPLOAD_ACTIVE_KEY = 'photo-de-jaldi:web-upload-active';
const WEB_UPLOAD_NOTICE_KEY = 'photo-de-jaldi:web-upload-notice-shown';
const WEB_UPLOAD_RESTART_MESSAGE =
  'An earlier browser upload was interrupted. Browser files cannot be restored; select them again and start over.';
const KEEP_SCREEN_OPEN_MESSAGE =
  "Keep this screen open and don't lock your phone until uploads finish.";

interface LocalUploadFile {
  uri: string;
  name: string;
  type: string;
  size: number;
  webFile?: File;
}

type QueueStatus = 'waiting' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface QueueItem {
  id: string;
  file: LocalUploadFile;
  status: QueueStatus;
  progress: number;
  error?: string;
  cancelling?: boolean;
}

interface UploadSession {
  result: InitiateMultipartResult;
  parts: Map<number, { etag: string; size: number }>;
}

interface BulkUploadQueueProps {
  bucketId: string;
  onUploaded: () => void;
}

function isImageFile(file: LocalUploadFile): boolean {
  return (
    file.type.toLowerCase().startsWith('image/') ||
    /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name)
  );
}

function isVideoFile(file: LocalUploadFile): boolean {
  return (
    file.type.toLowerCase().startsWith('video/') ||
    /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i.test(file.name)
  );
}

function getFileTypeLabel(file: LocalUploadFile): string {
  if (isImageFile(file)) return 'Image';
  if (isVideoFile(file)) return 'Video';
  if (file.type.startsWith('audio/')) return 'Audio';
  return file.type !== 'application/octet-stream'
    ? file.type.split('/').pop()?.toUpperCase() || 'File'
    : file.name.split('.').pop()?.toUpperCase() || 'File';
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      fullscreenOptions={{ enable: true }}
    />
  );
}

function getFriendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('etag response header')) {
    return 'The upload could not read its ETag. Check that the bucket CORS rule exposes ETag.';
  }
  if (message.includes('multipart upload session') || message.includes('upload session')) {
    return 'This upload session expired. Retry the file to start a new upload.';
  }
  if (message.includes('5 gb') || message.includes('maximum')) {
    return 'This file is larger than the 5 GB per-file limit.';
  }
  if (message.includes('quota') || message.includes('storage limit')) {
    return 'There is not enough available storage for this file.';
  }
  if (message.includes('upload limit') || message.includes('simultaneous uploads')) {
    return 'Too many uploads are already in progress. Try again shortly.';
  }
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch')
  ) {
    return 'Connection interrupted. Check your internet and try again.';
  }
  if (message.includes('expired') || message.includes('inactive')) {
    return 'This collection is no longer available for uploads.';
  }
  if (message.includes('unsupported') || message.includes('format')) {
    return 'This file type is not supported.';
  }
  return 'Upload failed. Please try again.';
}

export function BulkUploadQueue(props: BulkUploadQueueProps) {
  return <NativeBulkUploadQueue {...props} />;
}

function NativeBulkUploadQueue({ bucketId, onUploaded }: BulkUploadQueueProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchActive, setBatchActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<LocalUploadFile | null>(null);
  const [hasInterruptedUpload, setHasInterruptedUpload] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);
  const disposedRef = useRef(false);
  const batchActiveRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const pageHiddenRef = useRef(false);
  const pageVisibilityVersionRef = useRef(0);
  const activeItemsRef = useRef<Set<string>>(new Set());
  const cancelRequestedRef = useRef<Set<string>>(new Set());
  const finalizingRef = useRef<Set<string>>(new Set());
  const sessionsRef = useRef<Map<string, UploadSession>>(new Map());
  const statusRefreshIdsRef = useRef<Set<string>>(new Set());
  const webPartControllersRef = useRef<Map<string, AbortController>>(new Map());
  const progressUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const createdObjectUrlsRef = useRef<Set<string>>(new Set());
  const preserveInterruptedMarkerRef = useRef(false);
  const screenOpenAlertShownRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestRef = useRef(false);
  const dropZoneRef = useRef<HostInstance | null>(null);
  const startPendingRef = useRef<() => void>(() => undefined);

  const publishQueue = useCallback((nextQueue: QueueItem[]) => {
    queueRef.current = nextQueue;
    if (!disposedRef.current) setQueue(nextQueue);
  }, []);

  const updateItem = useCallback(
    (id: string, update: (item: QueueItem) => QueueItem) => {
      publishQueue(queueRef.current.map((item) => (item.id === id ? update(item) : item)));
    },
    [publishQueue]
  );

  const markWebUploadActive = () => {
    if (Platform.OS !== 'web') return;
    try {
      localStorage.setItem(WEB_UPLOAD_ACTIVE_KEY, 'active');
    } catch {
      // Uploads do not depend on browser storage; this only enables a restart notice.
    }
  };

  const clearWebUploadMarker = () => {
    if (Platform.OS !== 'web' || preserveInterruptedMarkerRef.current) return;
    try {
      localStorage.removeItem(WEB_UPLOAD_ACTIVE_KEY);
    } catch {
      // Uploads do not depend on browser storage; this only enables a restart notice.
    }
  };

  const showKeepScreenOpenAlertOnce = () => {
    if (Platform.OS !== 'web' || screenOpenAlertShownRef.current) return;
    screenOpenAlertShownRef.current = true;
    try {
      if (sessionStorage.getItem(WEB_UPLOAD_NOTICE_KEY) === 'shown') return;
      sessionStorage.setItem(WEB_UPLOAD_NOTICE_KEY, 'shown');
    } catch {
      // Fall back to the component ref when session storage is unavailable.
    }
    showAlert('Keep screen on during upload', KEEP_SCREEN_OPEN_MESSAGE);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let wasInterrupted = false;
    try {
      wasInterrupted = localStorage.getItem(WEB_UPLOAD_ACTIVE_KEY) === 'active';
      if (wasInterrupted) localStorage.removeItem(WEB_UPLOAD_ACTIVE_KEY);
    } catch {
      return;
    }
    if (!wasInterrupted) return;
    const timer = window.setTimeout(() => setHasInterruptedUpload(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const addFiles = useCallback(
    async (assets: DocumentPicker.DocumentPickerAsset[]) => {
      const newItems: QueueItem[] = [];

      for (const asset of assets) {
        if (queueRef.current.some((item) => item.file.uri === asset.uri)) continue;

        const webFile = Platform.OS === 'web' ? asset.file ?? undefined : undefined;
        let size =
          Platform.OS === 'web'
            ? webFile?.size ?? asset.size ?? 0
            : asset.size ?? 0;
        if (!size && Platform.OS !== 'web') {
          try {
            const info = await FileSystem.getInfoAsync(asset.uri);
            if (info.exists) size = info.size ?? 0;
          } catch {
            size = 0;
          }
        }

        const file: LocalUploadFile = {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || webFile?.type || 'application/octet-stream',
          size,
          webFile,
        };
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const error =
          size <= 0
            ? 'This file is empty or unavailable.'
            : Platform.OS === 'web' && size > WEB_MAX_FILE_SIZE_BYTES
              ? WEB_UPLOAD_LIMIT_MESSAGE
              : Platform.OS === 'web' && !webFile
                ? 'The browser file is unavailable. Please choose the file again.'
            : size > APP_LIMITS.MAX_FILE_SIZE_BYTES
              ? `This file is larger than the 5 GB per-file limit (${formatBytes(size)}).`
              : undefined;

        newItems.push({
          id,
          file,
          status: error ? 'failed' : 'waiting',
          progress: 0,
          error,
        });
      }

      if (newItems.length && !disposedRef.current) {
        publishQueue([...queueRef.current, ...newItems]);
        if (batchActiveRef.current) startPendingRef.current();
      }
    },
    [publishQueue]
  );

  const pickFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (disposedRef.current) return;
      if (!result.canceled) {
        setQueueError(null);
        await addFiles(result.assets);
      }
    } catch {
      if (!disposedRef.current) {
        setQueueError('Could not open the file picker. Please try again.');
      }
    }
  }, [addFiles]);

  const uploadItem = useCallback(
    async (item: QueueItem) => {
      const { file, id } = item;
      const tooLargeOnWeb =
        Platform.OS === 'web' && file.size > WEB_MAX_FILE_SIZE_BYTES;
      const missingWebFile = Platform.OS === 'web' && !file.webFile;
      if (
        file.size <= 0 ||
        file.size > APP_LIMITS.MAX_FILE_SIZE_BYTES ||
        tooLargeOnWeb ||
        missingWebFile
      ) {
        updateItem(id, (current) => ({
          ...current,
          status: 'failed',
          error: tooLargeOnWeb
            ? WEB_UPLOAD_LIMIT_MESSAGE
            : missingWebFile
              ? 'The browser file is unavailable. Please choose the file again.'
              : file.size > APP_LIMITS.MAX_FILE_SIZE_BYTES
                ? 'This file is larger than the 5 GB per-file limit.'
                : 'This file is empty or unavailable.',
        }));
        return;
      }

      let session = sessionsRef.current.get(id);
      const waitForResume = async () => {
        while (
          (pauseRequestedRef.current || pageHiddenRef.current) &&
          !cancelRequestedRef.current.has(id) &&
          !disposedRef.current
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      };
      const refreshSessionParts = async () => {
        if (!statusRefreshIdsRef.current.delete(id) || !session) return;
        const status = await getMultipartStatus(session.result.multipartUploadId);
        if (
          status.status === 'expired' ||
          status.status === 'aborted' ||
          new Date(status.expiresAt).getTime() <= Date.now()
        ) {
          sessionsRef.current.delete(id);
          session = undefined;
          throw new Error('Multipart upload session has expired.');
        }
        session.parts = new Map(
          status.parts.map((part) => [
            part.partNumber,
            { etag: part.etag, size: part.partSize },
          ])
        );
      };
      try {
        if (session) {
          const status = await getMultipartStatus(session.result.multipartUploadId);
          if (
            status.status === 'expired' ||
            status.status === 'aborted' ||
            new Date(status.expiresAt).getTime() <= Date.now()
          ) {
            sessionsRef.current.delete(id);
            session = undefined;
          } else {
            session.parts = new Map(
              status.parts.map((part) => [
                part.partNumber,
                { etag: part.etag, size: part.partSize },
              ])
            );
          }
        }

        if (!session) {
          const result = await initiateMultipartUpload(
            bucketId,
            file.name,
            file.size,
            file.type
          );
          session = { result, parts: new Map() };
          sessionsRef.current.set(id, session);
        }

        if (cancelRequestedRef.current.has(id)) {
          await abortMultipartUpload(session.result.multipartUploadId);
          sessionsRef.current.delete(id);
          cancelRequestedRef.current.delete(id);
          updateItem(id, (current) => ({
            ...current,
            status: 'cancelled',
            cancelling: false,
          }));
          return;
        }

        for (let partNumber = 1; partNumber <= session.result.totalParts; partNumber++) {
          await waitForResume();
          await refreshSessionParts();
          if (cancelRequestedRef.current.has(id)) {
            await abortMultipartUpload(session.result.multipartUploadId);
            sessionsRef.current.delete(id);
            cancelRequestedRef.current.delete(id);
            updateItem(id, (current) => ({
              ...current,
              status: 'cancelled',
              cancelling: false,
            }));
            return;
          }
          if (session.parts.has(partNumber)) continue;

          const { startByte, endByte } = getMultipartPartRange(
            file.size,
            session.result.partSize,
            partNumber
          );
          let uploadedPart: { partNumber: number; etag: string } | null = null;
          let lastError: unknown;

          for (let attempt = 0; attempt <= APP_LIMITS.MAX_PART_RETRIES; attempt++) {
            await waitForResume();
            if (cancelRequestedRef.current.has(id)) break;
            try {
              await refreshSessionParts();
              if (session.parts.has(partNumber)) {
                const recordedPart = session.parts.get(partNumber);
                if (recordedPart) {
                  uploadedPart = { partNumber, etag: recordedPart.etag };
                  break;
                }
              }
              const visibilityVersion = pageVisibilityVersionRef.current;
              const partUrl = await getPartUploadUrl(
                session.result.multipartUploadId,
                partNumber
              );
              await waitForResume();
              if (cancelRequestedRef.current.has(id)) break;
              if (visibilityVersion !== pageVisibilityVersionRef.current) {
                await refreshSessionParts();
                const recordedPart = session.parts.get(partNumber);
                if (recordedPart) {
                  uploadedPart = { partNumber, etag: recordedPart.etag };
                  break;
                }
                attempt -= 1;
                continue;
              }
              const bytesBeforePart = Array.from(session.parts.values()).reduce(
                (total, part) => total + part.size,
                0
              );
              const reportProgress = (loadedBytes: number) => {
                const now = Date.now();
                const lastUpdate = progressUpdatedAtRef.current.get(id) ?? 0;
                if (now - lastUpdate < 100 && loadedBytes < endByte - startByte) return;
                progressUpdatedAtRef.current.set(id, now);
                updateItem(id, (current) => ({
                  ...current,
                  progress: Math.min(
                    100,
                    Math.floor(((bytesBeforePart + loadedBytes) / file.size) * 100)
                  ),
                }));
              };
              let result: { partNumber: number; etag: string };
              if (Platform.OS === 'web') {
                const webFile = file.webFile;
                if (!webFile) throw new Error('The browser file is unavailable.');
                const { blob: partBlob } = getMultipartPartSlice(
                  webFile,
                  session.result.partSize,
                  partNumber
                );
                const controller = new AbortController();
                webPartControllersRef.current.set(id, controller);
                try {
                  result = await uploadWebPart(
                    partUrl.uploadUrl,
                    partBlob,
                    partNumber,
                    reportProgress,
                    controller.signal
                  );
                } finally {
                  if (webPartControllersRef.current.get(id) === controller) {
                    webPartControllersRef.current.delete(id);
                  }
                }
              } else {
                result = await uploadPart(
                  partUrl.uploadUrl,
                  file.uri,
                  partNumber,
                  startByte,
                  endByte,
                  file.type,
                  reportProgress
                );
              }
              await recordMultipartPart(
                session.result.multipartUploadId,
                result.partNumber,
                result.etag,
                endByte - startByte
              );
              uploadedPart = result;
              session.parts.set(partNumber, {
                etag: result.etag,
                size: endByte - startByte,
              });
              break;
            } catch (error) {
              if (cancelRequestedRef.current.has(id)) break;
              lastError = error;
              const retryable =
                !(error instanceof Error) ||
                !('retryable' in error) ||
                error.retryable !== false;
              if (!retryable || attempt === APP_LIMITS.MAX_PART_RETRIES) throw error;
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * 2 ** attempt)
              );
            }
          }

          if (!uploadedPart) throw lastError ?? new Error('Part upload failed.');
          const completedBytes = Array.from(session.parts.values()).reduce(
            (total, part) => total + part.size,
            0
          );
          updateItem(id, (current) => ({
            ...current,
            progress: Math.floor((completedBytes / file.size) * 100),
          }));
        }

        await waitForResume();
        if (cancelRequestedRef.current.has(id)) {
          await abortMultipartUpload(session.result.multipartUploadId);
          sessionsRef.current.delete(id);
          cancelRequestedRef.current.delete(id);
          updateItem(id, (current) => ({
            ...current,
            status: 'cancelled',
            cancelling: false,
          }));
          return;
        }

        finalizingRef.current.add(id);
        const parts = Array.from(session.parts.entries()).map(([partNumber, part]) => ({
          partNumber,
          etag: part.etag,
        }));
        await completeMultipartUpload(session.result.multipartUploadId, parts);
        sessionsRef.current.delete(id);
        progressUpdatedAtRef.current.delete(id);
        releaseCachedBlob(file.uri);
        updateItem(id, (current) => ({
          ...current,
          status: 'completed',
          progress: 100,
          error: undefined,
          cancelling: false,
        }));
        if (!disposedRef.current) onUploaded();
      } catch (error) {
        if (cancelRequestedRef.current.has(id)) {
          if (session) {
            try {
              await abortMultipartUpload(session.result.multipartUploadId);
              sessionsRef.current.delete(id);
              updateItem(id, (current) => ({
                ...current,
                status: 'cancelled',
                cancelling: false,
              }));
            } catch {
              updateItem(id, (current) => ({
                ...current,
                status: 'failed',
                cancelling: false,
                error: 'Could not cancel this upload. Please try again.',
              }));
            }
          } else {
            updateItem(id, (current) => ({
              ...current,
              status: 'cancelled',
              cancelling: false,
            }));
          }
          cancelRequestedRef.current.delete(id);
        } else {
          updateItem(id, (current) => ({
            ...current,
            status: 'failed',
            error: getFriendlyError(error),
          }));
        }
      } finally {
        finalizingRef.current.delete(id);
      }
    },
    [bucketId, onUploaded, updateItem]
  );

  startPendingRef.current = () => {
    if (
      !batchActiveRef.current ||
      pauseRequestedRef.current ||
      pageHiddenRef.current ||
      (Platform.OS === 'web' && disposedRef.current)
    ) {
      return;
    }
    while (activeItemsRef.current.size < APP_LIMITS.MAX_CONCURRENT_UPLOADS) {
      const next = queueRef.current.find((item) => item.status === 'waiting');
      if (!next) break;
      activeItemsRef.current.add(next.id);
      updateItem(next.id, (item) => ({ ...item, status: 'uploading', error: undefined }));
      void uploadItem(next).finally(() => {
        activeItemsRef.current.delete(next.id);
        const hasWaiting = queueRef.current.some((item) => item.status === 'waiting');
        if (!hasWaiting && activeItemsRef.current.size === 0) {
          batchActiveRef.current = false;
          pauseRequestedRef.current = false;
          pageHiddenRef.current = false;
          if (!disposedRef.current) setIsPaused(false);
          if (!disposedRef.current) setBatchActive(false);
          if (sessionsRef.current.size === 0) clearWebUploadMarker();
        } else {
          startPendingRef.current();
        }
      });
    }
  };

  const startUploads = () => {
    if (
      batchActiveRef.current ||
      !queueRef.current.some((item) => item.status === 'waiting')
    ) {
      return;
    }
    markWebUploadActive();
    showKeepScreenOpenAlertOnce();
    setHasInterruptedUpload(false);
    batchActiveRef.current = true;
    setBatchActive(true);
    startPendingRef.current();
  };

  const togglePause = () => {
    const shouldPause = !pauseRequestedRef.current;
    pauseRequestedRef.current = shouldPause;
    setIsPaused(shouldPause || pageHiddenRef.current);
    for (const id of activeItemsRef.current) {
      if (finalizingRef.current.has(id)) continue;
      updateItem(id, (item) => ({
        ...item,
        status: shouldPause || pageHiddenRef.current ? 'paused' : 'uploading',
      }));
    }
    if (!shouldPause && !pageHiddenRef.current) startPendingRef.current();
  };

  const cancelItem = async (item: QueueItem) => {
    if (item.status === 'waiting') {
      updateItem(item.id, (current) => ({ ...current, status: 'cancelled' }));
      return;
    }
    if (
      (item.status === 'uploading' || item.status === 'paused') &&
      !finalizingRef.current.has(item.id)
    ) {
      cancelRequestedRef.current.add(item.id);
      updateItem(item.id, (current) => ({ ...current, cancelling: true }));
    }
  };

  const removeItem = async (item: QueueItem) => {
    if (item.status === 'uploading' || item.status === 'paused') return;
    const session = sessionsRef.current.get(item.id);
    if (session) {
      if (item.status === 'waiting') {
        updateItem(item.id, (current) => ({ ...current, status: 'cancelled' }));
      }
      try {
        await abortMultipartUpload(session.result.multipartUploadId);
      } catch {
        updateItem(item.id, (current) => ({
          ...current,
          status: 'failed',
          error: 'Could not cancel this upload. Please try again.',
        }));
        return;
      }
    }
    if (createdObjectUrlsRef.current.delete(item.file.uri)) {
      URL.revokeObjectURL(item.file.uri);
    }
    releaseCachedBlob(item.file.uri);
    sessionsRef.current.delete(item.id);
    progressUpdatedAtRef.current.delete(item.id);
    publishQueue(queueRef.current.filter((entry) => entry.id !== item.id));
    if (!batchActiveRef.current && sessionsRef.current.size === 0) {
      clearWebUploadMarker();
    }
  };

  const retryItem = (item: QueueItem) => {
    updateItem(item.id, (current) => ({
      ...current,
      status: 'waiting',
      error: undefined,
      cancelling: false,
    }));
    if (batchActiveRef.current) {
      startPendingRef.current();
    } else {
      markWebUploadActive();
      showKeepScreenOpenAlertOnce();
      setHasInterruptedUpload(false);
      batchActiveRef.current = true;
      setBatchActive(true);
      startPendingRef.current();
    }
  };

  const clearQueue = () => {
    const pendingSessions: UploadSession[] = [];
    for (const item of queueRef.current) {
      if (createdObjectUrlsRef.current.delete(item.file.uri)) {
        URL.revokeObjectURL(item.file.uri);
      }
      releaseCachedBlob(item.file.uri);
      if (item.status !== 'completed') {
        const session = sessionsRef.current.get(item.id);
        if (session) pendingSessions.push(session);
      }
    }
    sessionsRef.current.clear();
    progressUpdatedAtRef.current.clear();
    publishQueue([]);
    setQueueError(null);
    clearWebUploadMarker();
    for (const session of pendingSessions) {
      void abortMultipartUpload(session.result.multipartUploadId).catch(() => {
        if (!disposedRef.current) {
          setQueueError('Some unfinished uploads could not be cancelled and will expire automatically.');
        }
      });
    }
  };

  const clearWaiting = async () => {
    const waitingItems = queueRef.current.filter((item) => item.status === 'waiting');
    for (const item of waitingItems) {
      updateItem(item.id, (current) => ({ ...current, status: 'cancelled' }));
    }
    for (const item of waitingItems) await removeItem(item);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dropZoneRef.current as unknown as HTMLElement | null;
    if (!node) return;

    const handleDragOver = (event: DragEvent) => event.preventDefault();
    const handleDragEnter = (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeave = () => setIsDragging(false);
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      const assets: DocumentPicker.DocumentPickerAsset[] = droppedFiles.map((file) => {
        const uri = URL.createObjectURL(file);
        createdObjectUrlsRef.current.add(uri);
        return {
          uri,
          name: file.name,
          size: file.size,
          mimeType: file.type || undefined,
          lastModified: file.lastModified,
          file,
        };
      });
      void addFiles(assets);
    };

    node.addEventListener('dragover', handleDragOver);
    node.addEventListener('dragenter', handleDragEnter);
    node.addEventListener('dragleave', handleDragLeave);
    node.addEventListener('drop', handleDrop);
    return () => {
      node.removeEventListener('dragover', handleDragOver);
      node.removeEventListener('dragenter', handleDragEnter);
      node.removeEventListener('dragleave', handleDragLeave);
      node.removeEventListener('drop', handleDrop);
    };
  }, [addFiles]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !batchActive) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [batchActive]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !batchActive) return;

    const releaseWakeLock = () => {
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (sentinel && !sentinel.released) {
        void sentinel.release().catch(() => undefined);
      }
    };

    const requestWakeLock = async () => {
      if (
        !('wakeLock' in navigator) ||
        !navigator.wakeLock ||
        !batchActiveRef.current ||
        document.visibilityState !== 'visible' ||
        wakeLockRequestRef.current ||
        (wakeLockRef.current && !wakeLockRef.current.released)
      ) {
        return;
      }

      wakeLockRequestRef.current = true;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!batchActiveRef.current || document.visibilityState !== 'visible') {
          await sentinel.release();
          return;
        }
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        });
      } catch {
        // Wake Lock is an optional browser capability.
      } finally {
        wakeLockRequestRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (!batchActiveRef.current) return;
        pageHiddenRef.current = true;
        pageVisibilityVersionRef.current += 1;
        setIsPaused(true);
        for (const id of activeItemsRef.current) {
          statusRefreshIdsRef.current.add(id);
          updateItem(id, (item) => ({ ...item, status: 'paused' }));
        }
        for (const controller of webPartControllersRef.current.values()) {
          controller.abort();
        }
        releaseWakeLock();
        return;
      }

      if (pageHiddenRef.current) {
        pageHiddenRef.current = false;
        const remainPaused = pauseRequestedRef.current;
        setIsPaused(remainPaused);
        for (const id of activeItemsRef.current) {
          updateItem(id, (item) => ({
            ...item,
            status: remainPaused ? 'paused' : 'uploading',
          }));
        }
        if (!remainPaused) startPendingRef.current();
      }
      void requestWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (document.visibilityState === 'hidden') {
      handleVisibilityChange();
    } else {
      void requestWakeLock();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [batchActive, updateItem]);

  useEffect(
    () => () => {
      if (
        Platform.OS === 'web' &&
        (batchActiveRef.current || sessionsRef.current.size > 0)
      ) {
        preserveInterruptedMarkerRef.current = true;
        try {
          localStorage.setItem(WEB_UPLOAD_ACTIVE_KEY, 'active');
        } catch {
          // Uploads do not depend on browser storage; this only enables a restart notice.
        }
      }
      disposedRef.current = true;
      if (Platform.OS === 'web') {
        for (const controller of webPartControllersRef.current.values()) {
          controller.abort();
        }
      }
      for (const id of activeItemsRef.current) cancelRequestedRef.current.add(id);
      for (const uri of createdObjectUrlsRef.current) URL.revokeObjectURL(uri);
      for (const [id, session] of sessionsRef.current) {
        if (activeItemsRef.current.has(id)) continue;
        void abortMultipartUpload(session.result.multipartUploadId).catch((error) => {
          console.warn('Failed to clean up an unfinished multipart upload.', error);
        });
      }
    },
    []
  );

  const completedCount = queue.filter((item) => item.status === 'completed').length;
  const remainingCount = queue.filter((item) => item.status !== 'completed').length;
  const totalBytes = queue.reduce((total, item) => total + item.file.size, 0);
  const uploadedBytes = queue.reduce(
    (total, item) => total + (item.file.size * item.progress) / 100,
    0
  );
  const overallProgress =
    totalBytes > 0 ? Math.floor((uploadedBytes / totalBytes) * 100) : 0;

  return (
    <View
      ref={dropZoneRef}
      style={[styles.container, isDragging && styles.dropActive]}
      testID="bulk-upload-queue"
    >
      {Platform.OS === 'web' && hasInterruptedUpload && (
        <View style={styles.interruptedBanner}>
          <Text style={styles.interruptedBannerText}>{WEB_UPLOAD_RESTART_MESSAGE}</Text>
        </View>
      )}
      {Platform.OS === 'web' && batchActive && (
        <View style={styles.keepScreenBanner}>
          <Text style={styles.keepScreenBannerText}>{KEEP_SCREEN_OPEN_MESSAGE}</Text>
        </View>
      )}

      <View style={styles.headingRow}>
        <View>
          <Text style={styles.heading}>Add photos and files</Text>
          <Text style={styles.subheading}>Select one or more items to upload</Text>
        </View>
        <Ionicons name="cloud-upload-outline" size={24} color={tokens.color.info} />
      </View>

      {queueError && <Text style={styles.itemError}>{queueError}</Text>}

      <Pressable
        style={styles.dropZone}
        onPress={pickFiles}
        accessibilityRole="button"
        accessibilityLabel="Choose photos and files to upload"
      >
        <View style={styles.dropIcon}>
          <Ionicons name="add" size={24} color={tokens.color.primaryText} />
        </View>
        <Text style={styles.dropTitle}>
          {isDragging ? 'Drop files to add them' : 'Choose files'}
        </Text>
        <Text style={styles.dropHint}>
          {Platform.OS === 'web' ? 'or drag and drop them here' : 'Photos, videos, and other files'}
        </Text>
      </Pressable>

      {queue.length > 0 && (
        <>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.summaryTitle}>
                {queue.length} {queue.length === 1 ? 'file' : 'files'} selected
              </Text>
              <Text style={styles.summaryDetail}>
                {completedCount} uploaded · {remainingCount} remaining
              </Text>
            </View>
            <View style={styles.summaryActions}>
              {batchActive && (
                <Pressable
                  onPress={togglePause}
                  accessibilityRole="button"
                  accessibilityLabel={isPaused ? 'Resume uploads' : 'Pause uploads'}
                  style={styles.pauseControl}
                >
                  <Ionicons
                    name={isPaused ? 'play-outline' : 'pause-outline'}
                    size={16}
                    color={tokens.color.textMuted}
                  />
                  <Text style={styles.pauseLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={clearWaiting}
                disabled={!queue.some((item) => item.status === 'waiting')}
                accessibilityRole="button"
                accessibilityLabel="Remove waiting files"
                style={styles.iconButton}
              >
                <Ionicons name="close-circle-outline" size={20} color={tokens.color.textMuted} />
              </Pressable>
              <Pressable
                onPress={clearQueue}
                disabled={batchActive}
                accessibilityRole="button"
                accessibilityLabel="Clear selection"
                style={styles.iconButton}
              >
                <Ionicons name="trash-outline" size={18} color={tokens.color.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={styles.batchProgress}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${overallProgress}%` }]} />
            </View>
            <View style={styles.batchProgressLabels}>
              <Text style={styles.progressLabel}>Batch progress</Text>
              <Text style={styles.progressLabel}>{overallProgress}%</Text>
            </View>
          </View>

          <View style={styles.grid}>
            {queue.map((item) => (
              <Card key={item.id} variant="subtle" style={styles.fileCard}>
                <Pressable
                  accessibilityRole={isVideoFile(item.file) ? 'button' : undefined}
                  accessibilityLabel={
                    isVideoFile(item.file)
                      ? `Preview ${item.file.name}`
                      : item.file.name
                  }
                  onPress={() => {
                    if (isVideoFile(item.file)) setPreviewFile(item.file);
                  }}
                  style={styles.thumbnail}
                >
                  {isImageFile(item.file) ? (
                    <Image
                      source={{ uri: item.file.uri }}
                      style={styles.thumbnailImage}
                      contentFit="cover"
                      transition={120}
                      accessibilityLabel={item.file.name}
                    />
                  ) : (
                    <FileTypeIcon
                      mimeType={item.file.type}
                      fileName={item.file.name}
                      size={58}
                    />
                  )}
                  {isVideoFile(item.file) && (
                    <View style={styles.playOverlay}>
                      <Ionicons name="play" size={18} color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
                <Text style={styles.fileName} numberOfLines={2}>
                  {item.file.name}
                </Text>
                <Text style={styles.fileSize}>
                  {getFileTypeLabel(item.file)} · {formatBytes(item.file.size)}
                </Text>
                <View style={styles.statusRow}>
                  <Ionicons
                    name={
                      item.status === 'completed'
                        ? 'checkmark-circle'
                        : item.status === 'failed'
                          ? 'alert-circle'
                          : item.status === 'uploading'
                            ? 'cloud-upload-outline'
                            : item.status === 'paused'
                              ? 'pause-outline'
                            : item.status === 'cancelled'
                              ? 'close-circle-outline'
                              : 'time-outline'
                    }
                    size={14}
                    color={
                      item.status === 'completed'
                        ? tokens.color.primaryText
                        : item.status === 'failed'
                          ? tokens.color.danger
                          : tokens.color.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.statusText,
                      item.status === 'failed' && { color: tokens.color.danger },
                    ]}
                    numberOfLines={1}
                  >
                    {item.cancelling
                      ? 'Cancelling…'
                      : item.status === 'waiting'
                        ? 'Waiting'
                        : item.status === 'uploading'
                          ? `Uploading · ${item.progress}%`
                          : item.status === 'paused'
                            ? 'Paused'
                          : item.status === 'completed'
                            ? 'Uploaded'
                            : item.status === 'failed'
                              ? 'Failed'
                              : 'Cancelled'}
                  </Text>
                  {item.status !== 'uploading' && item.status !== 'paused' && (
                    <Pressable
                      onPress={() =>
                        item.status === 'failed'
                          ? retryItem(item)
                          : void removeItem(item)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={item.status === 'failed' ? 'Retry upload' : 'Remove file'}
                      style={styles.itemAction}
                    >
                      <Ionicons
                        name={item.status === 'failed' ? 'refresh-outline' : 'close'}
                        size={17}
                        color={item.status === 'failed' ? tokens.color.info : tokens.color.textMuted}
                      />
                    </Pressable>
                  )}
                  {(item.status === 'uploading' || item.status === 'paused') &&
                    !finalizingRef.current.has(item.id) && (
                    <Pressable
                      onPress={() => void cancelItem(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel upload"
                      style={styles.itemAction}
                    >
                      <Ionicons name="close" size={17} color={tokens.color.textMuted} />
                    </Pressable>
                  )}
                </View>
                {(item.status === 'uploading' ||
                  item.status === 'paused' ||
                  item.status === 'failed') && (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${item.progress}%` }]} />
                  </View>
                )}
                {item.error && (
                  <Text style={styles.itemError} numberOfLines={3}>
                    {item.error}
                  </Text>
                )}
              </Card>
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              title="Add more"
              onPress={pickFiles}
              variant="outline"
              icon={<Ionicons name="add" size={18} color={tokens.color.text} />}
              style={styles.actionButton}
            />
            <Button
              title={batchActive ? (isPaused ? 'Resume' : 'Uploading…') : 'Upload files'}
              onPress={batchActive && isPaused ? togglePause : startUploads}
              disabled={
                (batchActive && !isPaused) ||
                (!batchActive && !queue.some((item) => item.status === 'waiting'))
              }
              loading={batchActive && !isPaused}
              variant="primary"
              icon={
                !batchActive || isPaused ? (
                  <Ionicons name="cloud-upload-outline" size={18} color={tokens.color.onPrimary} />
                ) : undefined
              }
              style={styles.actionButton}
            />
          </View>
        </>
      )}

      <Modal
        visible={Boolean(previewFile)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewFile(null)}
      >
        <View style={styles.previewOverlay}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewName} numberOfLines={1}>
              {previewFile?.name}
            </Text>
            <Pressable
              onPress={() => setPreviewFile(null)}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
            >
              <Ionicons name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
          {previewFile && <VideoPreview uri={previewFile.uri} />}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    backgroundColor: tokens.color.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  keepScreenBanner: {
    padding: Spacing.sm,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.sm,
    backgroundColor: tokens.color.surfaceRaised,
    borderWidth: 1,
    borderColor: tokens.color.info,
  },
  keepScreenBannerText: {
    color: tokens.color.info,
    fontSize: Typography.size.xs,
    textAlign: 'center',
  },
  interruptedBanner: {
    padding: Spacing.sm,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.sm,
    backgroundColor: tokens.color.surfaceRaised,
    borderWidth: 1,
    borderColor: tokens.color.warning,
  },
  interruptedBannerText: {
    color: tokens.color.warning,
    fontSize: Typography.size.xs,
    textAlign: 'center',
  },
  dropActive: {
    borderColor: tokens.color.primaryText,
    backgroundColor: tokens.color.primarySoft,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  heading: {
    color: tokens.color.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  subheading: {
    color: tokens.color.textMuted,
    fontSize: Typography.size.xs,
    marginTop: Spacing.xs,
  },
  dropZone: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 128,
    padding: Spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.color.border,
    borderRadius: BorderRadius.md,
    backgroundColor: tokens.color.surfaceRaised,
  },
  dropIcon: {
    height: 40,
    width: 40,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.color.primarySoft,
    marginBottom: Spacing.sm,
  },
  dropTitle: {
    color: tokens.color.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  dropHint: {
    color: tokens.color.textMuted,
    fontSize: Typography.size.xs,
    marginTop: Spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  summaryTitle: {
    color: tokens.color.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
  },
  summaryDetail: {
    color: tokens.color.textMuted,
    fontSize: Typography.size.xs,
    marginTop: 2,
  },
  summaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pauseControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
  },
  pauseLabel: {
    color: tokens.color.textMuted,
    fontSize: Typography.size.xs,
  },
  iconButton: {
    padding: Spacing.sm,
  },
  batchProgress: {
    marginBottom: Spacing.md,
  },
  batchProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  progressLabel: {
    color: tokens.color.textMuted,
    fontSize: Typography.size.xs,
  },
  progressTrack: {
    height: 5,
    overflow: 'hidden',
    backgroundColor: tokens.color.surfaceRaised,
    borderRadius: BorderRadius.full,
  },
  progressFill: {
    height: '100%',
    backgroundColor: tokens.color.primaryText,
    borderRadius: BorderRadius.full,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  fileCard: {
    width: '31%',
    minWidth: 100,
    flexGrow: 1,
    padding: Spacing.sm,
    marginBottom: 0,
  },
  thumbnail: {
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: BorderRadius.sm,
    backgroundColor: tokens.color.surfaceRaised,
    marginBottom: Spacing.xs,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    width: 34,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  fileName: {
    minHeight: 32,
    color: tokens.color.text,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
  },
  fileSize: {
    color: tokens.color.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  statusRow: {
    minHeight: 23,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.xs,
  },
  statusText: {
    flex: 1,
    color: tokens.color.textMuted,
    fontSize: 10,
  },
  itemAction: {
    padding: 3,
  },
  itemError: {
    color: tokens.color.danger,
    fontSize: 10,
    marginTop: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
  },
  previewOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.94)',
    padding: Spacing.md,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  previewName: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: Typography.size.md,
  },
  video: {
    width: '100%',
    height: 300,
    backgroundColor: '#000000',
  },
});
