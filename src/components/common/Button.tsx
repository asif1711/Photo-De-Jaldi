import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { useTheme } from '@/hooks/useColorScheme';
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
  const { colors } = useTheme();

  const getColors = () => {
    if (disabled) {
      return {
        bg: colors.surfaceSubtle,
        text: colors.textMuted,
        border: colors.border,
      };
    }
    switch (variant) {
      case 'primary':
        return {
          bg: colors.primary,
          text: '#FFFFFF',
          border: 'transparent',
        };
      case 'secondary':
        return {
          bg: colors.surfaceSubtle,
          text: colors.text,
          border: 'transparent',
        };
      case 'outline':
        return {
          bg: 'transparent',
          text: colors.text,
          border: colors.borderStrong,
        };
      case 'danger':
        return {
          bg: colors.dangerBg,
          text: colors.danger,
          border: 'transparent',
        };
      default:
        return {
          bg: colors.primary,
          text: '#FFFFFF',
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
