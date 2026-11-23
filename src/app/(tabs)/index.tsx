import { BorderRadius, Spacing, Typography } from '@/constants/Layout';
import { useAuth } from '@/context/AuthContext';
import { getActiveBuckets } from '@/services/bucket';
import { AppText, Card, Highlight, Pill, PrimaryButton, SecondaryButton } from '@/theme/components';
import { tokens } from '@/theme/tokens';
import { Bucket } from '@/types';
import { formatDate, formatTimeRemaining } from '@/utils/formatters';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
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

  const displayName = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? null;
  const initial = displayName ? displayName.charAt(0).toUpperCase() : null;

  const statusTone = (status: string): 'primary' | 'warning' | 'danger' | undefined => {
    switch (status) {
      case 'active':
        return 'primary';
      case 'completed':
        return 'primary';
      case 'expired':
        return 'danger';
      default:
        return undefined;
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchBuckets(true)}
          tintColor={tokens.color.primaryText}
          colors={[tokens.color.primaryText]}
        />
      }>
      {/* Greeting */}
      <View style={styles.greetingRow}>
        <View style={styles.greetingStart}>
          {initial ? (
            <View style={styles.avatar}>
              <AppText variant="label" style={styles.avatarText}>
                {initial}
              </AppText>
            </View>
          ) : null}
          <View style={styles.greetingText}>
            {displayName ? (
              <>
                <AppText variant="body">Hello, <Highlight style={styles.highlight}>{displayName}</Highlight></AppText>
              </>
            ) : (
              <AppText variant="body">Hello, Guest</AppText>
            )}
          </View>
        </View>
        <SecondaryButton onPress={() => signOut()}>Sign Out</SecondaryButton>
      </View>

      {/* Quick Action Card */}
      <Card style={styles.actionCard}>
        <View style={styles.actionHeader}>
          <View style={styles.actionIconContainer}>
            <Ionicons name="cloud-upload" size={24} color={tokens.color.primaryText} />
          </View>
          <View style={styles.actionTextContainer}>
            <AppText variant="body" style={styles.actionTitle}>
              New Collection
            </AppText>
            <AppText variant="caption" style={styles.actionDescription}>
              Create a temporary collection with auto-deletion
            </AppText>
          </View>
        </View>
        <PrimaryButton
          icon={<Ionicons name="add" size={18} color={tokens.color.onPrimary} />}
          onPress={() => router.push('/bucket/create')}>
          Create Collection
        </PrimaryButton>
      </Card>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <AppText variant="title">Your Collections</AppText>
        <Pill>{buckets.length} active</Pill>
      </View>

      {/* Error State */}
      {errorMessage && (
        <Card style={styles.errorCard}>
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={24} color={tokens.color.danger} />
            <View style={styles.errorTextContainer}>
              <AppText variant="body" style={styles.errorTitle}>
                Failed to load buckets
              </AppText>
              <AppText variant="caption" style={styles.errorDescription}>
                {errorMessage}
              </AppText>
            </View>
          </View>
          <SecondaryButton style={styles.retryButton} onPress={() => fetchBuckets()}>
            Try Again
          </SecondaryButton>
        </Card>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={tokens.color.primaryText} />
          <AppText variant="caption" style={styles.loadingText}>
            Loading your buckets…
          </AppText>
        </View>
      )}

      {/* Empty State */}
      {!loading && !errorMessage && buckets.length === 0 && (
        <Card style={styles.emptyCard}>
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={36} color={tokens.color.textMuted} />
            <View style={styles.emptyTitleRow}>
            <AppText variant="title">No </AppText>
            <Highlight style={styles.emptyHighlight}>Active</Highlight>
            <AppText variant="title"> Collections</AppText>
            </View>
            <AppText variant="caption" style={{ ...styles.emptyDescription, textAlign: 'center' }}>
              You do not have any active collections yet. Create a collection to temporarily share files.
            </AppText>
            <PrimaryButton style={styles.emptyButton} onPress={() => router.push('/bucket/create')}>
              Create First Collection
            </PrimaryButton>
          </View>
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
                    <Ionicons name="folder" size={20} color={tokens.color.primaryText} />
                    <AppText variant="body" style={styles.bucketName} numberOfLines={1}>
                      {bucket.name}
                    </AppText>
                  </View>
                  <Pill tone={statusTone(bucket.status)}>{bucket.status}</Pill>
                </View>

                {bucket.description ? (
                  <AppText variant="caption" style={styles.bucketDescription} numberOfLines={2}>
                    {bucket.description}
                  </AppText>
                ) : null}

                <View style={styles.metaRow}>
                  <AppText variant="caption" style={styles.metaText}>
                    Created: {formatDate(bucket.created_at)}
                  </AppText>
                </View>

                <View style={styles.ruleNotice}>
                  <Ionicons name="timer-outline" size={14} color={tokens.color.textMuted} />
                  <AppText variant="caption" style={styles.ruleNoticeText}>
                    Expires: {formatDate(bucket.expires_at)} ({timeLeft})
                  </AppText>
                </View>

                <SecondaryButton
                  style={styles.viewButton}
                  onPress={() => router.push(`/bucket/${bucket.id}`)}>
                  View Collection Details
                </SecondaryButton>
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
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  greetingStart: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tokens.color.surfaceRaised,
    borderWidth: tokens.borderWidth,
    borderColor: tokens.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: tokens.color.text,
  },
  greetingText: {
    flex: 1,
  },
  highlight: {
    fontSize: Typography.size.lg,
  },
  actionCard: {
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  actionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tokens.color.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.size.md,
  },
  actionDescription: {
    marginTop: Spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  errorCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    alignItems: 'center',
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
    fontSize: Typography.size.md,
  },
  errorDescription: {
    fontSize: Typography.size.xs,
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
  retryButton: {
    marginTop: Spacing.md,
    width: '100%',
  },
  loadingContainer: {
    paddingVertical: Spacing.xxxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: Typography.size.sm,
    marginTop: Spacing.sm,
  },
  emptyCard: {
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    maxWidth: 300,
  },
  emptyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  emptyHighlight: {
    fontSize: Typography.size.xxl,
  },
  emptyDescription: {
    fontSize: Typography.size.sm,
    lineHeight: 18,
    marginTop: Spacing.xs,
    maxWidth: 260,
  },
  emptyButton: {
    marginTop: Spacing.lg,
    width: '100%',
  },
  bucketCard: {
    marginBottom: Spacing.md,
    padding: Spacing.lg,
  },
  bucketCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
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
    flex: 1,
  },
  bucketDescription: {
    fontSize: Typography.size.xs,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  metaText: {
    marginTop: Spacing.xs,
  },
  ruleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
    marginVertical: Spacing.sm,
    backgroundColor: tokens.color.surfaceRaised,
  },
  ruleNoticeText: {
    fontSize: Typography.size.xs,
    flex: 1,
  },
  viewButton: {
    marginTop: Spacing.sm,
    width: '100%',
  },
});
