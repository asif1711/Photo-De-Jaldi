import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { Spacing, Typography } from '@/constants/Layout';

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function Header({ title, subtitle, action }: HeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: tokens.color.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: tokens.color.textMuted }]}>{subtitle}</Text>
        )}
      </View>
      {action && <View style={styles.actionContainer}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: Typography.size.title,
    fontWeight: Typography.weight.bold,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Typography.size.sm,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  actionContainer: {
    marginLeft: Spacing.md,
  },
});
