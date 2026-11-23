import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
}: ButtonProps) {
  const getColors = () => {
    if (disabled) {
      return {
        bg: tokens.color.surfaceRaised,
        text: tokens.color.textMuted,
        border: tokens.color.border,
      };
    }
    switch (variant) {
      case 'primary':
        return {
          bg: tokens.color.primary,
          text: tokens.color.onPrimary,
          border: 'transparent',
        };
      case 'secondary':
        return {
          bg: tokens.color.surfaceRaised,
          text: tokens.color.text,
          border: 'transparent',
        };
      case 'outline':
        return {
          bg: 'transparent',
          text: tokens.color.text,
          border: tokens.color.border,
        };
      case 'danger':
        return {
          bg: tokens.color.dangerSoft,
          text: tokens.color.danger,
          border: 'transparent',
        };
      default:
        return {
          bg: tokens.color.primary,
          text: tokens.color.onPrimary,
          border: 'transparent',
        };
    }
  };

  const { bg, text, border } = getColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={text} />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, { color: text, marginLeft: icon ? Spacing.sm : 0 }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  text: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
  },
});
