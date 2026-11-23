import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useColorScheme';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export type BadgeVariant = 'active' | 'completed' | 'expired' | 'pending' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  const { colors } = useTheme();

  const getVariantStyles = () => {
    switch (variant) {
      case 'active':
        return {
          bg: colors.status.activeBg,
          text: colors.status.active,
        };
      case 'completed':
        return {
          bg: colors.status.completedBg,
          text: colors.status.completed,
        };
      case 'expired':
        return {
          bg: colors.status.expiredBg,
          text: colors.status.expired,
        };
      case 'pending':
        return {
          bg: colors.status.pendingBg,
          text: colors.status.pending,
        };
      case 'neutral':
      default:
        return {
          bg: colors.surfaceSubtle,
          text: colors.textSecondary,
        };
    }
  };

  const { bg, text } = getVariantStyles();

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
