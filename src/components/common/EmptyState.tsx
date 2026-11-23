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
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
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
    lineHeight: 20,
    maxWidth: 320,
  },
  actionContainer: {
    marginTop: Spacing.xl,
    width: '100%',
    maxWidth: 240,
  },
});
