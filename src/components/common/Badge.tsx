import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export type BadgeVariant = 'active' | 'completed' | 'expired' | 'pending' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'active':
        return {
          bg: tokens.color.primarySoft,
          text: tokens.color.primaryText,
        };
      case 'completed':
        return {
          bg: tokens.color.infoSoft,
          text: tokens.color.info,
        };
      case 'expired':
        return {
          bg: tokens.color.dangerSoft,
          text: tokens.color.danger,
        };
      case 'pending':
        return {
          bg: tokens.color.warningSoft,
          text: tokens.color.warning,
        };
      case 'neutral':
      default:
        return {
          bg: tokens.color.surfaceRaised,
          text: tokens.color.textMuted,
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
