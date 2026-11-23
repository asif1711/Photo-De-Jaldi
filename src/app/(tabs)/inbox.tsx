import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useColorScheme';
import { Header } from '@/components/common/Header';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { Spacing, Typography } from '@/constants/Layout';

export default function InboxScreen() {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}>
      <Header
        title="Shared Inbox"
        subtitle="Temporary buckets shared with you"
      />

      {/* Info Notice about auto-deletion policy */}
      <Card variant="subtle" style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
          <View style={styles.infoTextContainer}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>
              Auto-Destruct Policy
            </Text>
            <Text style={[styles.infoDescription, { color: colors.textSecondary }]}>
              When all invited members complete their downloads, or the bucket expires, the bucket
              and all its files are permanently purged from private storage.
            </Text>
          </View>
        </View>
      </Card>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Shared With Me</Text>
        <Badge label="Invitation Stage" variant="neutral" />
      </View>

      {/* Empty State */}
      <Card variant="subtle">
        <EmptyState
          icon={<Ionicons name="mail-open-outline" size={36} color={colors.textSecondary} />}
          title="Inbox Empty"
          description="When other registered users invite your email to their buckets in the upcoming invitation stage, they will appear here ready to download."
        />
      </Card>
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
  infoCard: {
    marginBottom: Spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    marginBottom: 2,
  },
  infoDescription: {
    fontSize: Typography.size.xs,
    lineHeight: 18,
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
});
