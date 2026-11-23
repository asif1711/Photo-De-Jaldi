import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { Header } from '@/components/common/Header';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { Spacing, Typography } from '@/constants/Layout';

export default function InboxScreen() {
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.color.bg }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}>
      <Header
        title="Shared Collections"
        subtitle="Temporary collections shared with you"
      />

      {/* Info Notice about auto-deletion policy */}
      <Card variant="subtle" style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="information-circle-outline" size={20} color={tokens.color.info} />
          <View style={styles.infoTextContainer}>
            <Text style={[styles.infoTitle, { color: tokens.color.text }]}>
              Auto-Deletion
            </Text>
            <Text style={[styles.infoDescription, { color: tokens.color.textMuted }]}>
              When all invited members complete their downloads, or the collection expires, the
              collection and its files are permanently removed.
            </Text>
          </View>
        </View>
      </Card>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: tokens.color.text }]}>Shared With Me</Text>
        <Badge label="Invitation Stage" variant="neutral" />
      </View>

      {/* Empty State */}
      <Card variant="subtle">
        <EmptyState
          icon={<Ionicons name="mail-open-outline" size={36} color={tokens.color.textMuted} />}
          title="No Shared Collections"
          description="When others invite your email to their collections, they will appear here ready to download."
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
    marginBottom: Spacing.xs,
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
