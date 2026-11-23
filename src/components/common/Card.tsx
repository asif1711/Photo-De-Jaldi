import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { tokens } from '@/theme/tokens';
import { BorderRadius, Spacing } from '@/constants/Layout';

interface CardProps extends ViewProps {
  children: React.ReactNode;
  variant?: 'default' | 'subtle';
}

export function Card({ children, style, variant = 'default', ...props }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: variant === 'default' ? tokens.color.surface : tokens.color.surfaceRaised,
          borderColor: tokens.color.border,
        },
        style,
      ]}
      {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginVertical: Spacing.xs,
  },
});
