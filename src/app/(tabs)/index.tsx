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
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useColorScheme';
import { Header } from '@/components/common/Header';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { getActiveBuckets } from '@/services/bucket';
import { Bucket } from '@/types';
import { formatDate, formatTimeRemaining } from '@/utils/formatters';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, signOut } = useAuth();

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchBuckets = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);

    const { data, error } = await getActiveBuckets();

    if (error) {
      setErrorMessage(error);
    } else {
      setBuckets(data || []);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  // Refresh active buckets whenever the user returns to this tab
  useFocusEffect(
    useCallback(() => {
      fetchBuckets();
    }, [fetchBuckets])
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchBuckets(true)}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }>
      <Header
        title="My Buckets"
        subtitle={user?.email ? `Signed in as ${user.email}` : 'Temporary file-sharing spaces'}
        action={
          <Button
            title="Sign Out"
            variant="outline"
            onPress={() => signOut()}
            icon={<Ionicons name="log-out-outline" size={16} color={colors.text} />}
            style={styles.signOutButton}
          />
        }
      />

      {/* Quick Action Card */}
      <Card style={styles.actionCard}>
        <View style={styles.actionHeader}>
          <View style={[styles.actionIconContainer, { backgroundColor: colors.primaryLight }]}>
            <Ionicons name="cloud-upload" size={24} color={colors.primary} />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={[styles.actionTitle, { color: colors.text }]}>New Shared Bucket</Text>
            <Text style={[styles.actionDescription, { color: colors.textSecondary }]}>
              Create a temporary bucket with auto-deletion
            </Text>
          </View>
        </View>
        <Button
          title="Create Bucket"
          variant="primary"
          onPress={() => router.push('/bucket/create')}
          icon={<Ionicons name="add" size={18} color="#FFFFFF" />}
        />
      </Card>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Active Buckets</Text>
        {!loading && (
          <Badge
            label={`${buckets.length} Active`}
            variant={buckets.length > 0 ? 'active' : 'neutral'}
          />
        )}
      </View>

      {/* Error State */}
      {errorMessage && (
        <Card style={styles.errorCard}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
            <View style={styles.errorTextContainer}>
              <Text style={[styles.errorTitle, { color: colors.danger }]}>Failed to load buckets</Text>
              <Text style={[styles.errorDescription, { color: colors.textSecondary }]}>
                {errorMessage}
              </Text>
            </View>
          </View>
          <Button
            title="Try Again"
            variant="outline"
            onPress={() => fetchBuckets()}
            style={styles.retryButton}
          />
        </Card>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Loading your buckets...
          </Text>
        </View>
      )}

      {/* Empty State */}
      {!loading && !errorMessage && buckets.length === 0 && (
        <Card variant="subtle">
          <EmptyState
            icon={<Ionicons name="folder-open-outline" size={36} color={colors.textSecondary} />}
            title="No Active Buckets"
            description="You don't have any active buckets right now. Create a bucket to temporarily share files."
            action={
              <Button
                title="Create First Bucket"
                variant="primary"
                onPress={() => router.push('/bucket/create')}
                icon={<Ionicons name="add" size={16} color="#FFFFFF" />}
              />
            }
          />
        </Card>
      )}

      {/* Real Buckets List */}
      {!loading &&
        buckets.map((bucket) => {
          const timeLeft = formatTimeRemaining(bucket.expires_at);

          return (
            <TouchableOpacity
              key={bucket.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/bucket/${bucket.id}`)}>
              <Card style={styles.bucketCard}>
                <View style={styles.bucketCardTop}>
                  <View style={styles.bucketTitleRow}>
                    <Ionicons name="folder" size={20} color={colors.primary} />
                    <Text style={[styles.bucketName, { color: colors.text }]} numberOfLines={1}>
                      {bucket.name}
                    </Text>
                  </View>
                  <Badge label={bucket.status} variant="active" />
                </View>

                {bucket.description ? (
                  <Text style={[styles.bucketDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                    {bucket.description}
                  </Text>
                ) : null}

                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: colors.textMuted }]}>
                    Created: {formatDate(bucket.created_at)}
                  </Text>
                </View>

                <View style={[styles.ruleNotice, { backgroundColor: colors.surfaceSubtle }]}>
                  <Ionicons name="timer-outline" size={14} color={colors.status.pending} />
                  <Text style={[styles.ruleNoticeText, { color: colors.textSecondary }]}>
                    Expires: {formatDate(bucket.expires_at)} ({timeLeft})
                  </Text>
                </View>

                <Button
                  title="View Bucket Details"
                  variant="outline"
                  onPress={() => router.push(`/bucket/${bucket.id}`)}
                  icon={<Ionicons name="arrow-forward" size={16} color={colors.text} />}
                  style={styles.viewButton}
                />
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
  signOutButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  actionCard: {
    marginBottom: Spacing.lg,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  actionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
  },
  actionDescription: {
    fontSize: Typography.size.xs,
    marginTop: 2,
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
  bucketCard: {
    marginBottom: Spacing.md,
  },
  bucketCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  bucketTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
    marginRight: Spacing.sm,
  },
  bucketName: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    flex: 1,
  },
  bucketDescription: {
    fontSize: Typography.size.sm,
    marginTop: 2,
    marginBottom: Spacing.xs,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  metaText: {
    fontSize: Typography.size.xs,
  },
  ruleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
    marginVertical: Spacing.xs,
  },
  ruleNoticeText: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  viewButton: {
    marginTop: Spacing.xs,
  },
});
