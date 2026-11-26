import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
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
import { BulkUploadQueue } from '@/components/BulkUploadQueue';
import {
  getBucketById,
  updateBucket,
} from '@/services/bucket';
import {
  deleteFile,
  deleteFiles,
  downloadFileToCache,
  getBucketFiles,
  getStorageUsage,
  authorizeDownload,
  MAX_FILES_PER_DELETE_ACTION,
} from '@/services/storage';
import { Bucket } from '@/types';
import { formatBytes, formatDate, formatTimeRemaining } from '@/utils/formatters';
import { showAlert } from '@/utils/alert';
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
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [deletingSelectedFiles, setDeletingSelectedFiles] = useState<boolean>(false);
  const [storageUsage, setStorageUsage] = useState<{
    total_bytes: number;
    committed_bytes: number;
    reserved_bytes: number;
    available_bytes: number;
    limit_bytes: number;
    utilization_percent: number;
  } | null>(null);

  // Download state
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

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
      const uniqueFiles = Array.from(new Map(fetched.map((file) => [file.id, file])).values());
      const availableFileIds = new Set(uniqueFiles.map((file) => file.id));
      setFiles(uniqueFiles);
      setSelectedFileIds((current) => current.filter((fileId) => availableFileIds.has(fileId)));
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
      showAlert('Updated', 'Bucket details updated successfully.');
    }
  };

  // --- Download flow ---

  const handleDownload = async (file: any) => {
    if (!file || downloadingFileId === file.id) return;
    setDownloadingFileId(file.id);

    if (Platform.OS === 'web') {
      try {
        const result = await authorizeDownload(file.id);
        const anchor = document.createElement('a');
        anchor.href = result.downloadUrl;
        anchor.download = result.fileName;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        try {
          anchor.click();
        } finally {
          anchor.remove();
        }
        setDownloadNote(
          'If the download does not start, try again later; daily limits may apply'
        );
      } catch (error) {
        setDownloadNote(
          error instanceof Error ? error.message : 'Could not start the download.'
        );
      } finally {
        setDownloadingFileId(null);
      }
      return;
    }

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
        showAlert('Downloaded', `File saved to ${localUri}`);
      }
    } catch (err: any) {
      setDownloadProgress((prev) => {
        const { [file.id]: _removed, ...rest } = prev;
        return rest;
      });
      showAlert('Download Failed', err?.message || 'Failed to download file.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  // --- Delete flow ---

  const handleDeleteFile = async (file: any) => {
    if (!file) return;

    showAlert(
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
              setSelectedFileIds((current) => current.filter((id) => id !== file.id));
              await fetchFiles();
              await fetchStorageUsage();
              showAlert('Deleted', 'File removed from bucket.');
            } catch (err: any) {
              showAlert('Delete Failed', err?.message || 'Failed to delete file.');
            }
          },
        },
      ]
    );
  };

  const toggleFileSelection = (fileId: string) => {
    if (selectedFileIds.includes(fileId)) {
      setSelectedFileIds((current) => current.filter((id) => id !== fileId));
      return;
    }

    if (selectedFileIds.length >= MAX_FILES_PER_DELETE_ACTION) {
      showAlert(
        'Selection limit reached',
        `You can delete up to ${MAX_FILES_PER_DELETE_ACTION} files at once.`
      );
      return;
    }

    setSelectedFileIds((current) => [...current, fileId]);
  };

  const handleDeleteSelectedFiles = () => {
    if (!isOwner || !selectedFileIds.length || deletingSelectedFiles) return;
    const fileIds = [...selectedFileIds];

    showAlert(
      'Delete selected files',
      `Delete ${fileIds.length} selected file${fileIds.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingSelectedFiles(true);
            try {
              const result = await deleteFiles(fileIds);
              await Promise.all([fetchFiles(), fetchStorageUsage()]);
              setSelectedFileIds(result.failedFileIds);

              if (result.failedFileIds.length) {
                showAlert(
                  'Some files were not deleted',
                  `${result.deletedFileIds.length} deleted. ${result.failedFileIds.length} could not be deleted; select them to retry.`
                );
              } else {
                showAlert('Deleted', `${result.deletedFileIds.length} files deleted.`);
              }
            } catch (err: any) {
              showAlert('Delete Failed', err?.message || 'Failed to delete selected files.');
            } finally {
              setDeletingSelectedFiles(false);
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
                    Added:{' '}
                    <Text style={{ color: tokens.color.text, fontWeight: Typography.weight.semibold }}>
                      {formatDate(bucket.created_at)}
                    </Text>
                  </Text>
                </View>

                <View style={styles.statusRow}>
                  <Ionicons name="timer-outline" size={16} color={tokens.color.warning} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Expires:{' '}
                    <Text style={{ color: tokens.color.text, fontWeight: Typography.weight.semibold }}>
                      {formatDate(bucket.expires_at)} ({formatTimeRemaining(bucket.expires_at)})
                    </Text>
                  </Text>
                </View>

                {isOwner && (
                  <View style={styles.statusRow}>
                    <Ionicons name="person-outline" size={16} color={tokens.color.textMuted} />
                    <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                      Owner:{' '}
                      <Text style={{ color: tokens.color.text, fontWeight: Typography.weight.bold }}>
                        You
                      </Text>
                    </Text>
                  </View>
                )}

                <View style={styles.statusRow}>
                  <Ionicons name="sync-outline" size={16} color={tokens.color.textMuted} />
                  <Text style={[styles.statusLabel, { color: tokens.color.textMuted }]}>
                    Updated:{' '}
                    <Text style={{ color: tokens.color.text }}>{formatDate(bucket.updated_at)}</Text>
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
                </View>
              )}
            </Card>

            {/* Storage Indicator */}
            <Card variant="subtle" style={styles.storageCard}>
              <View style={styles.storageHeader}>
                <Ionicons name="cloud-outline" size={20} color={tokens.color.info} />
                <Text style={[styles.storageTitle, { color: tokens.color.text }]}>Storage</Text>
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
                      {formatBytes(storageUsage.available_bytes)} available
                    </Text>
                    <Text style={[styles.storagePercent, { color: tokens.color.textMuted }]}>
                      {(storageUsage.utilization_percent || 0).toFixed(0)}% of limit
                    </Text>
                  </View>
                </View>
              ) : (
                <ActivityIndicator size="small" color={tokens.color.primaryText} />
              )}
            </Card>

            {/* Files Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Files</Text>
              <Badge label={filesLoading ? 'Loading' : 'Files'} variant="neutral" />
            </View>

            {Platform.OS === 'web' && downloadNote ? (
              <View
                style={{
                  padding: Spacing.sm,
                  marginBottom: Spacing.sm,
                  borderRadius: BorderRadius.sm,
                  backgroundColor: tokens.color.surfaceRaised,
                }}
              >
                <Text style={{ color: tokens.color.textMuted, fontSize: Typography.size.xs }}>
                  {downloadNote}
                </Text>
              </View>
            ) : null}

            <BulkUploadQueue
              bucketId={bucket.id}
              onUploaded={() => {
                void fetchFiles();
                void fetchStorageUsage();
              }}
            />

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
                  title="No Files Yet"
                  description={
                    Platform.OS === 'web'
                      ? 'This collection has no files yet.'
                      : 'Choose photos, videos, or other files above to add them to this collection.'
                  }
                />
              </Card>
            )}

            {!filesLoading && files.length > 0 && (
              <View style={styles.fileList}>
                {isOwner && selectedFileIds.length > 0 && (
                  <View style={styles.selectionActions}>
                    <Text style={[styles.selectedCount, { color: tokens.color.text }]}>
                      {selectedFileIds.length} selected
                    </Text>
                    <Button
                      title={`Delete ${selectedFileIds.length}`}
                      variant="danger"
                      onPress={handleDeleteSelectedFiles}
                      disabled={deletingSelectedFiles}
                      loading={deletingSelectedFiles}
                      icon={
                        !deletingSelectedFiles ? (
                          <Ionicons name="trash-outline" size={16} color={tokens.color.danger} />
                        ) : undefined
                      }
                    />
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Clear file selection"
                      disabled={deletingSelectedFiles}
                      onPress={() => setSelectedFileIds([])}
                    >
                      <Ionicons name="close-circle-outline" size={24} color={tokens.color.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}
                {files.map((file) => {
                  const isDownloading = downloadingFileId === file.id;
                  const progress = downloadProgress[file.id] || 0;
                  const isSelected = selectedFileIds.includes(file.id);
                  return (
                    <Card
                      key={file.id}
                      style={styles.fileCard}
                      variant={isOwner ? 'default' : 'subtle'}
                    >
                      <View style={styles.fileRow}>
                        {isOwner && (
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${file.file_name}`}
                            disabled={deletingSelectedFiles}
                            onPress={() => toggleFileSelection(file.id)}
                          >
                            <Ionicons
                              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                              size={24}
                              color={isSelected ? tokens.color.primaryText : tokens.color.textMuted}
                            />
                          </TouchableOpacity>
                        )}
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
                              {formatBytes(file.file_size)} • {formatDate(file.created_at)}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.fileActions}>
                          {isDownloading ? (
                            Platform.OS === 'web' ? (
                              <View style={{ alignItems: 'center', gap: Spacing.xs }}>
                                <ActivityIndicator size="small" color={tokens.color.info} />
                                <Text style={{ color: tokens.color.textMuted }}>
                                  Preparing download…
                                </Text>
                              </View>
                            ) : (
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
                            )
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
                              disabled={deletingSelectedFiles}
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
              <Text style={[styles.modalTitle, { color: tokens.color.text }]}>Edit Collection</Text>
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
              label="Collection Name *"
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
    marginTop: Spacing.xs,
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
    marginTop: Spacing.xs,
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
    marginTop: Spacing.xs,
  },
  storagePercent: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: Spacing.xs,
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
  filesCard: {
    marginBottom: Spacing.lg,
  },
  fileList: {
    gap: Spacing.md,
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: tokens.color.surface,
  },
  selectedCount: {
    flex: 1,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
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
    marginTop: Spacing.xs,
  },
  fileDate: {
    fontSize: Typography.size.xs,
    color: tokens.color.textMuted,
    marginTop: Spacing.xs,
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
    marginBottom: Spacing.xs,
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
