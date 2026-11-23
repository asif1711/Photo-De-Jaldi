import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { Spacing, Typography } from '@/constants/Layout';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: tokens.color.surfaceRaised }]}>
        {icon}
      </View>
      <Text style={[styles.title, { color: tokens.color.text }]}>{title}</Text>
      <Text style={[styles.description, { color: tokens.color.textMuted }]}>{description}</Text>
      {action && <View style={styles.actionContainer}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xxl,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.semibold,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  description: {
    fontSize: Typography.size.sm,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  actionContainer: {
    marginTop: Spacing.xxl,
    width: '100%',
    maxWidth: 260,
  },
});
