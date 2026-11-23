import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useColorScheme';
import { Header } from '@/components/common/Header';
import { Card } from '@/components/common/Card';
import { Badge, BadgeVariant } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { getHistoryBuckets } from '@/services/bucket';
import { Bucket } from '@/types';
import { formatDate } from '@/utils/formatters';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export default function HistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    const { data, error } = await getHistoryBuckets();

    if (error) {
      setErrorMessage(error);
    } else {
      setBuckets(data || []);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchHistory();
    }, [fetchHistory])
  );

  const getStatusVariant = (status: string, expiresAt: string): { label: string; variant: BadgeVariant } => {
    const isExpiredTime = new Date(expiresAt).getTime() <= Date.now();
    if (status === 'completed') {
      return { label: 'Completed', variant: 'completed' };
    }
    if (status === 'expired' || isExpiredTime) {
      return { label: 'Expired', variant: 'expired' };
    }
    return { label: status, variant: 'neutral' };
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchHistory(true)}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }>
      <Header
        title="Activity History"
        subtitle="Completed & expired bucket logs"
      />

      {/* Rules Explanation Card */}
      <Card variant="subtle" style={styles.rulesCard}>
        <Text style={[styles.rulesTitle, { color: colors.text }]}>Deletion Triggers</Text>
        <View style={styles.ruleItem}>
          <Ionicons name="checkmark-done-circle" size={16} color={colors.status.active} />
          <Text style={[styles.ruleText, { color: colors.textSecondary }]}>
            Condition 1: Every invited member completes bucket download.
          </Text>
        </View>
        <View style={styles.ruleItem}>
          <Ionicons name="timer" size={16} color={colors.status.expired} />
          <Text style={[styles.ruleText, { color: colors.textSecondary }]}>
            Condition 2: Bucket reaches its configured expiry date.
          </Text>
        </View>
      </Card>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Past Buckets</Text>
        {!loading && (
          <Badge label={`${buckets.length} Records`} variant="neutral" />
        )}
      </View>

      {/* Error State */}
      {errorMessage && (
        <Card style={styles.errorCard}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
            <View style={styles.errorTextContainer}>
              <Text style={[styles.errorTitle, { color: colors.danger }]}>Failed to load history</Text>
              <Text style={[styles.errorDescription, { color: colors.textSecondary }]}>
                {errorMessage}
              </Text>
            </View>
          </View>
          <Button
            title="Try Again"
            variant="outline"
            onPress={() => fetchHistory()}
            style={styles.retryButton}
          />
        </Card>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading bucket history...
          </Text>
        </View>
      )}

      {/* Empty State */}
      {!loading && !errorMessage && buckets.length === 0 && (
        <Card variant="subtle">
          <EmptyState
            icon={<Ionicons name="time-outline" size={36} color={colors.textSecondary} />}
            title="No Past Records"
            description="Completed and expired buckets will appear here once their lifecycle has concluded."
          />
        </Card>
      )}

      {/* Real History Items */}
      {!loading &&
        buckets.map((bucket) => {
          const statusInfo = getStatusVariant(bucket.status, bucket.expires_at);

          return (
            <TouchableOpacity
              key={bucket.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/bucket/${bucket.id}`)}>
              <Card style={styles.historyCard}>
                <View style={styles.historyCardTop}>
                  <View style={styles.historyTitleRow}>
                    <Ionicons
                      name={statusInfo.variant === 'completed' ? 'archive-outline' : 'time-outline'}
                      size={18}
                      color={statusInfo.variant === 'completed' ? colors.status.completed : colors.status.expired}
                    />
                    <Text style={[styles.historyName, { color: colors.text }]} numberOfLines={1}>
                      {bucket.name}
                    </Text>
                  </View>
                  <Badge label={statusInfo.label} variant={statusInfo.variant} />
                </View>

                {bucket.description ? (
                  <Text style={[styles.historyDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                    {bucket.description}
                  </Text>
                ) : null}

                <Text style={[styles.historyMeta, { color: colors.textSecondary }]}>
                  Created: {formatDate(bucket.created_at)} • Expired/Completed: {formatDate(bucket.expires_at)}
                </Text>
              </Card>
            </TouchableOpacity>
          );
        })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  rulesCard: {
    marginBottom: Spacing.lg,
  },
  rulesTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.sm,
  },
  ruleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: 3,
  },
  ruleText: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
  },
  loadingContainer: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: Typography.size.sm,
    marginTop: Spacing.sm,
  },
  errorCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  errorTextContainer: {
    flex: 1,
  },
  errorTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    marginBottom: 2,
  },
  errorDescription: {
    fontSize: Typography.size.xs,
    lineHeight: 18,
  },
  retryButton: {
    marginTop: Spacing.md,
  },
  historyCard: {
    marginBottom: Spacing.sm,
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  historyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
    marginRight: Spacing.sm,
  },
  historyName: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    flex: 1,
  },
  historyDescription: {
    fontSize: Typography.size.sm,
    marginTop: 2,
    marginBottom: Spacing.xs,
  },
  historyMeta: {
    fontSize: Typography.size.xs,
    marginTop: 2,
  },
});
