import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Card, Pill, SectionHeader } from '@/theme/components';
import { tokens } from '@/theme/tokens';
import { APP_LIMITS, BACKBLAZE_B2_FREE_CAPS } from '@/constants/caps';
import {
  getStorageUsage,
  type FileStatusBreakdown,
  type StorageUsageResult,
} from '@/services/storage';

const FILE_STATUSES = [
  {
    status: 'uploaded',
    label: 'Uploaded',
    description: 'Available files in unexpired buckets',
    icon: 'checkmark-circle-outline',
    color: tokens.color.primaryText,
  },
  {
    status: 'expired',
    label: 'Expired',
    description: 'Uploaded files awaiting expiry cleanup',
    icon: 'time-outline',
    color: tokens.color.warning,
  },
  {
    status: 'deleted',
    label: 'Deleted',
    description: 'Files marked deleted after cleanup or user deletion',
    icon: 'trash-outline',
    color: tokens.color.textMuted,
  },
] as const;

function formatDecimalBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${Math.max(0, bytes)} B`;
}

function countForStatus(
  breakdown: FileStatusBreakdown[],
  status: FileStatusBreakdown['file_status']
): FileStatusBreakdown {
  return (
    breakdown.find((entry) => entry.file_status === status) ?? {
      file_status: status,
      file_count: 0,
      total_bytes: 0,
    }
  );
}

export default function StorageScreen() {
  const [usage, setUsage] = useState<StorageUsageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStorage = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage(null);

    try {
      setUsage(await getStorageUsage());
    } catch (error) {
      console.error('[storage-tab] Could not load storage summary', error);
      setErrorMessage('Storage details could not be loaded. Pull to refresh and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadStorage();
    }, [loadStorage])
  );

  const capacityBytes = APP_LIMITS.TOTAL_STORAGE_BYTES;
  const usedBytes = usage ? usage.committed_bytes + usage.reserved_bytes : 0;
  const remainingBytes = Math.max(0, capacityBytes - usedBytes);
  const percentUsed = capacityBytes > 0 ? (usedBytes / capacityBytes) * 100 : 0;
  const progressPercent = Math.min(100, Math.max(0, percentUsed));
  const databaseLimitMismatch =
    usage !== null && usage.maximum_bytes !== APP_LIMITS.TOTAL_STORAGE_BYTES;
  const downloadCapBytes = BACKBLAZE_B2_FREE_CAPS.DOWNLOAD_BANDWIDTH_BYTES_PER_DAY;
  const downloadPercent =
    usage?.download_bytes_today == null
      ? null
      : (usage.download_bytes_today / downloadCapBytes) * 100;
  const downloadProgressPercent =
    downloadPercent === null ? 0 : Math.min(100, Math.max(0, downloadPercent));
  const downloadUsageColor =
    downloadPercent !== null && downloadPercent >= 100
      ? tokens.color.danger
      : downloadPercent !== null && downloadPercent >= 75
        ? tokens.color.warning
        : tokens.color.primaryText;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void loadStorage(true)}
          tintColor={tokens.color.primaryText}
          colors={[tokens.color.primaryText]}
        />
      }
    >
      <SectionHeader title="Storage overview" />

      {loading && !usage ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={tokens.color.primaryText} />
          <AppText variant="caption">Loading storage details...</AppText>
        </View>
      ) : errorMessage && !usage ? (
        <Card style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={22} color={tokens.color.danger} />
          <AppText style={styles.errorText}>{errorMessage}</AppText>
        </Card>
      ) : usage ? (
        <>
          {errorMessage && (
            <Card style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={22} color={tokens.color.danger} />
              <AppText style={styles.errorText}>{errorMessage}</AppText>
            </Card>
          )}

          {databaseLimitMismatch && (
            <Card style={styles.warningCard}>
              <Ionicons name="warning-outline" size={22} color={tokens.color.warning} />
              <View style={styles.warningCopy}>
                <AppText variant="label" style={styles.warningTitle}>
                  Storage limit mismatch
                </AppText>
                <AppText variant="caption">
                  App capacity is {formatDecimalBytes(capacityBytes)}, but the database quota is{' '}
                  {formatDecimalBytes(usage.maximum_bytes)}. Uploads use the database quota, which
                  reports {formatDecimalBytes(usage.available_bytes)} available.
                </AppText>
              </View>
            </Card>
          )}

          <Card style={styles.capacityCard}>
            <View style={styles.capacityHeading}>
              <AppText variant="label">Total capacity</AppText>
              <Pill
                tone={
                  percentUsed >= APP_LIMITS.STORAGE_WARNING_THRESHOLD * 100
                    ? 'warning'
                    : 'primary'
                }
              >
                {`${Math.max(0, percentUsed).toFixed(1)}% used`}
              </Pill>
            </View>
            <AppText variant="title" style={styles.capacityValue}>
              {formatDecimalBytes(capacityBytes)}
            </AppText>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              <View
                style={[
                  styles.thresholdMarker,
                  { left: `${APP_LIMITS.STORAGE_WARNING_THRESHOLD * 100}%` },
                ]}
              />
            </View>
            <View style={styles.thresholdRow}>
              <AppText variant="caption">{formatDecimalBytes(usedBytes)} used</AppText>
              <AppText variant="caption" style={styles.thresholdLabel}>
                90% warning
              </AppText>
            </View>

            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <AppText variant="caption">Used</AppText>
                <AppText variant="label" style={styles.summaryValue}>
                  {formatDecimalBytes(usedBytes)}
                </AppText>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCell}>
                <AppText variant="caption">Remaining</AppText>
                <AppText variant="label" style={styles.summaryValue}>
                  {formatDecimalBytes(remainingBytes)}
                </AppText>
              </View>
            </View>
            <AppText variant="caption" style={styles.accountingNote}>
              Used includes committed files and active upload reservations.
            </AppText>
          </Card>

          <SectionHeader title="File breakdown" style={styles.sectionHeader} />
          <AppText variant="caption" style={styles.breakdownNote}>
            Expired includes uploaded files in expired or deleting buckets, or buckets past expiry,
            until cleanup marks them deleted.
          </AppText>
          {FILE_STATUSES.map((item) => {
            const entry = countForStatus(usage.file_status_breakdown, item.status);
            return (
              <Card key={item.status} style={styles.statusCard}>
                <View style={styles.statusIcon}>
                  <Ionicons name={item.icon} size={22} color={item.color} />
                </View>
                <View style={styles.statusCopy}>
                  <AppText variant="label">{item.label}</AppText>
                  <AppText variant="caption">{item.description}</AppText>
                </View>
                <View style={styles.statusTotals}>
                  <AppText variant="label" style={styles.statusCount}>
                    {entry.file_count.toLocaleString()}
                  </AppText>
                  <AppText variant="caption">{formatDecimalBytes(entry.total_bytes)}</AppText>
                </View>
              </Card>
            );
          })}

          <SectionHeader title="Limits" style={styles.sectionHeader} />
          <Card style={styles.limitsCard}>
            <View style={styles.downloadUsage}>
              <View style={styles.downloadUsageHeading}>
                <AppText variant="label">
                  Download bandwidth today (estimated)
                </AppText>
                <AppText variant="label" style={{ color: downloadUsageColor }}>
                  {usage.download_bytes_today == null
                    ? 'usage unavailable'
                    : `${formatDecimalBytes(usage.download_bytes_today)} / ${formatDecimalBytes(downloadCapBytes)}`}
                </AppText>
              </View>
              <View style={styles.downloadTrack}>
                <View
                  style={[
                    styles.downloadFill,
                    {
                      width: `${downloadProgressPercent}%`,
                      backgroundColor: downloadUsageColor,
                    },
                  ]}
                />
              </View>
              <AppText variant="caption" style={styles.limitsNote}>
                Estimated, resets 12:00 AM GMT. The Backblaze Caps &amp; Alerts page is the source
                of truth.
              </AppText>
            </View>
            <LimitRow
              icon="cloud-download-outline"
              label="Download bandwidth"
              value={`${formatDecimalBytes(downloadCapBytes)}/day`}
            />
            <LimitRow
              icon="swap-horizontal-outline"
              label="Class B transactions"
              value={`${BACKBLAZE_B2_FREE_CAPS.CLASS_B_TRANSACTIONS_PER_DAY.toLocaleString()}/day`}
            />
            <LimitRow
              icon="list-outline"
              label="Class C transactions"
              value={`${BACKBLAZE_B2_FREE_CAPS.CLASS_C_TRANSACTIONS_PER_DAY.toLocaleString()}/day`}
            />
            <AppText variant="caption" style={styles.limitsNote}>
              Class B and Class C transaction limits are static account caps; live transaction
              usage is not recorded in the database.
            </AppText>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

interface LimitRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}

function LimitRow({ icon, label, value }: LimitRowProps) {
  return (
    <View style={styles.limitRow}>
      <Ionicons name={icon} size={20} color={tokens.color.info} />
      <AppText variant="label" style={styles.limitLabel}>
        {label}
      </AppText>
      <AppText variant="label" style={styles.limitValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg,
  },
  content: {
    padding: tokens.space[16],
    paddingBottom: tokens.space[24],
  },
  loading: {
    alignItems: 'center',
    gap: tokens.space[12],
    paddingVertical: tokens.space[24],
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[12],
    padding: tokens.space[16],
    marginBottom: tokens.space[12],
  },
  errorText: {
    flex: 1,
    color: tokens.color.danger,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.space[12],
    padding: tokens.space[16],
    backgroundColor: tokens.color.warningSoft,
    marginBottom: tokens.space[12],
  },
  warningCopy: {
    flex: 1,
    gap: tokens.space[4],
  },
  warningTitle: {
    color: tokens.color.warning,
  },
  capacityCard: {
    padding: tokens.space[16],
  },
  capacityHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.space[8],
  },
  capacityValue: {
    fontFamily: 'Fraunces_600SemiBold',
    color: tokens.color.primaryText,
    marginTop: tokens.space[4],
    marginBottom: tokens.space[16],
  },
  progressTrack: {
    height: 10,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.surfaceRaised,
    overflow: 'visible',
  },
  progressFill: {
    height: '100%',
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.primaryText,
  },
  thresholdMarker: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: 18,
    backgroundColor: tokens.color.warning,
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: tokens.space[8],
  },
  thresholdLabel: {
    color: tokens.color.warning,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: tokens.space[16],
    paddingTop: tokens.space[12],
    borderTopWidth: tokens.borderWidth,
    borderTopColor: tokens.color.border,
  },
  summaryCell: {
    flex: 1,
    gap: tokens.space[4],
  },
  summaryValue: {
    color: tokens.color.text,
  },
  summaryDivider: {
    width: tokens.borderWidth,
    height: 34,
    backgroundColor: tokens.color.border,
    marginHorizontal: tokens.space[16],
  },
  accountingNote: {
    marginTop: tokens.space[12],
  },
  sectionHeader: {
    marginTop: tokens.space[24],
    marginBottom: tokens.space[4],
  },
  breakdownNote: {
    marginBottom: tokens.space[8],
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[12],
    padding: tokens.space[12],
    marginBottom: tokens.space[8],
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: {
    flex: 1,
    gap: tokens.space[4],
  },
  statusTotals: {
    alignItems: 'flex-end',
    gap: tokens.space[4],
  },
  statusCount: {
    color: tokens.color.text,
  },
  limitsCard: {
    paddingHorizontal: tokens.space[16],
    paddingVertical: tokens.space[8],
  },
  downloadUsage: {
    gap: tokens.space[8],
    paddingVertical: tokens.space[12],
    borderBottomWidth: tokens.borderWidth,
    borderBottomColor: tokens.color.border,
  },
  downloadUsageHeading: {
    gap: tokens.space[4],
  },
  downloadTrack: {
    height: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.surfaceRaised,
    overflow: 'hidden',
  },
  downloadFill: {
    height: '100%',
    borderRadius: tokens.radius.pill,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space[12],
    paddingVertical: tokens.space[12],
    borderBottomWidth: tokens.borderWidth,
    borderBottomColor: tokens.color.border,
  },
  limitLabel: {
    flex: 1,
  },
  limitValue: {
    color: tokens.color.text,
  },
  limitsNote: {
    marginTop: tokens.space[8],
    marginBottom: tokens.space[8],
  },
});
