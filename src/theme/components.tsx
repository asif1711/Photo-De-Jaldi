/**
 * Dark-only reusable UI components for Photo De Jaldi.
 * Built on src/theme/tokens.ts. No light theme, no useColorScheme branching.
 */

import React, { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
  type TextInputProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Svg, Circle } from 'react-native-svg';
import { tokens, fonts, FontName } from './tokens';

type IconName = React.ComponentProps<typeof Feather>['name'];

/* ------------------------------------------------------------------ */
/* AppText                                                            */
/* ------------------------------------------------------------------ */

export type AppTextVariant = 'body' | 'label' | 'title' | 'caption';

interface AppTextProps {
  variant?: AppTextVariant;
  style?: TextStyle;
  numberOfLines?: number;
  children: React.ReactNode;
}

const variantFonts: Record<AppTextVariant, FontName> = {
  body: fonts.body,
  label: fonts.label,
  title: fonts.title,
  caption: fonts.body,
};

const variantStyles: Record<AppTextVariant, TextStyle> = {
  body: { fontSize: 15, lineHeight: 22 },
  label: {
    fontSize: 13,
    color: tokens.color.textMuted,
    lineHeight: 18,
  },
  title: { fontSize: 20, lineHeight: 26 },
  caption: { fontSize: 12, color: tokens.color.textMuted, lineHeight: 16 },
};

export function AppText({ variant = 'body', style, numberOfLines, children }: AppTextProps) {
  return (
    <Text
      style={[
        { fontFamily: variantFonts[variant], color: tokens.color.text },
        variantStyles[variant],
        style,
      ]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}

/**
 * Single emphasised word inside a heading. Fraunces 600 Italic, primaryText.
 */
interface HighlightProps {
  style?: TextStyle;
  children: React.ReactNode;
}
export function Highlight({ style, children }: HighlightProps) {
  return (
    <Text
      style={[
        { fontFamily: fonts.headingItalic as FontName, color: tokens.color.primaryText },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/* AppTextInput                                                       */
/* ------------------------------------------------------------------ */

interface AppTextInputProps extends Omit<TextInputProps, 'style'> {
  style?: TextInputProps['style'];
}

export function AppTextInput({ style, ...props }: AppTextInputProps) {
  return (
    <TextInput
      placeholderTextColor={tokens.color.textMuted}
      style={[
        {
          fontFamily: fonts.body,
          color: tokens.color.text,
          backgroundColor: tokens.color.surfaceRaised,
          borderWidth: tokens.borderWidth,
          borderColor: tokens.color.border,
          borderRadius: tokens.radius.card,
          minHeight: 48,
          paddingHorizontal: tokens.space[16],
          paddingVertical: tokens.space[12],
        },
        style,
      ]}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                               */
/* ------------------------------------------------------------------ */

interface CardProps {
  style?: ViewStyle;
  children: React.ReactNode;
}
export function Card({ style, children }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: tokens.color.surface,
          borderWidth: tokens.borderWidth,
          borderColor: tokens.color.border,
          borderRadius: tokens.radius.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pill                                                               */
/* ------------------------------------------------------------------ */

export type PillTone = 'info' | 'warning' | 'danger' | 'primary';

interface PillProps {
  style?: ViewStyle;
  tone?: PillTone;
  children: React.ReactNode;
}

function resolvePill(tone?: PillTone) {
  switch (tone) {
    case 'info':
      return { bg: tokens.color.infoSoft, color: tokens.color.info };
    case 'warning':
      return { bg: tokens.color.warningSoft, color: tokens.color.warning };
    case 'danger':
      return { bg: tokens.color.dangerSoft, color: tokens.color.danger };
    case 'primary':
      return { bg: tokens.color.primarySoft, color: tokens.color.primary };
    default:
      return { bg: tokens.color.surfaceRaised, color: tokens.color.textMuted };
  }
}

export function Pill({ style, tone, children }: PillProps) {
  const { bg, color } = resolvePill(tone);
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: tokens.radius.pill,
          paddingHorizontal: tokens.space[8],
          paddingVertical: 2,
        },
        style,
      ]}
    >
      <AppText variant="label" style={{ color }}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                            */
/* ------------------------------------------------------------------ */

const buttonBase: ViewStyle = {
  borderRadius: tokens.radius.card,
  paddingVertical: tokens.space[12],
  paddingHorizontal: tokens.space[16],
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: tokens.space[8],
};

interface BaseButtonProps {
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export function PrimaryButton({
  onPress,
  disabled = false,
  style,
  children,
  icon,
}: BaseButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          ...buttonBase,
          backgroundColor: disabled
            ? tokens.color.textDisabled
            : tokens.color.primary,
        },
        style,
      ]}
    >
      {icon}
      <AppText
        variant="label"
        style={{
          color: tokens.color.onPrimary,
        }}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

export function SecondaryButton({
  onPress,
  disabled = false,
  style,
  children,
  icon,
}: BaseButtonProps) {
  const borderColor = disabled
    ? tokens.color.textDisabled
    : tokens.color.border;
  const textColor = disabled
    ? tokens.color.textDisabled
    : tokens.color.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          ...buttonBase,
          backgroundColor: tokens.color.surfaceRaised,
          borderWidth: tokens.borderWidth,
          borderColor,
        },
        style,
      ]}
    >
      {icon}
      <AppText
        variant="label"
        style={{ color: textColor }}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

interface DangerButtonProps {
  onPress: () => void;
  style?: ViewStyle;
  children: React.ReactNode;
}
export function DangerButton({ onPress, style, children }: DangerButtonProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        {
          ...buttonBase,
          backgroundColor: pressed
            ? tokens.color.dangerSoft
            : 'transparent',
        },
        style,
      ]}
    >
      <AppText
        variant="label"
        style={{ color: tokens.color.danger }}
      >
        {children}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* SectionHeader                                                      */
/* ------------------------------------------------------------------ */

interface SectionHeaderProps {
  title: string;
  onSeeMore?: () => void;
  style?: ViewStyle;
}
export function SectionHeader({ title, onSeeMore, style }: SectionHeaderProps) {
  return (
    <View style={[{ marginBottom: tokens.space[16] }, style]}>
      <AppText variant="title">{title}</AppText>
      {onSeeMore ? (
        <TouchableOpacity
          onPress={onSeeMore}
          style={{ marginTop: tokens.space[4] }}
        >
          <AppText variant="caption" style={{ color: tokens.color.info }}>
            See more
          </AppText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* FileTypeIcon                                                       */
/* ------------------------------------------------------------------ */

type FileType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

function detectFileType(mimeType?: string, fileName?: string): FileType {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(name))
    return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/.test(name))
    return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a)$/.test(name))
    return 'audio';
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('document') ||
    /\.(pdf|doc|docx|txt|md|csv)$/.test(name)
  )
    return 'document';
  if (mime.includes('zip') || mime.includes('tar') || /\.(zip|tar|gz|rar)$/.test(name))
    return 'archive';
  return 'other';
}

function iconForType(type: FileType): IconName {
  switch (type) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'music';
    case 'document':
      return 'file-text';
    case 'archive':
      return 'package';
    default:
      return 'file';
  }
}

interface FileTypeIconProps {
  mimeType?: string;
  fileName?: string;
  size?: number;
}
export function FileTypeIcon({ mimeType, fileName, size = 40 }: FileTypeIconProps) {
  const type = detectFileType(mimeType, fileName);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor: tokens.color.surfaceRaised,
          borderRadius: tokens.radius.card,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Feather
        name={iconForType(type)}
        size={size * 0.45}
        color={tokens.color.textMuted}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* StatusIcon + upload progress helper                                */
/* ------------------------------------------------------------------ */

export type UploadState = 'queued' | 'uploading' | 'paused' | 'done' | 'failed';

interface StatusIconProps {
  state: UploadState;
  size?: number;
}

function statusForState(state: UploadState): { icon: IconName; color: string } {
  switch (state) {
    case 'queued':
      return { icon: 'clock', color: tokens.color.textMuted };
    case 'uploading':
      return { icon: 'upload', color: tokens.color.info };
    case 'paused':
      return { icon: 'pause', color: tokens.color.warning };
    case 'done':
      return { icon: 'check-circle', color: tokens.color.primaryText };
    case 'failed':
      return { icon: 'alert-circle', color: tokens.color.danger };
  }
}

export function StatusIcon({ state, size = 20 }: StatusIconProps) {
  const { icon, color } = statusForState(state);
  return <Feather name={icon} size={size} color={color} />;
}

interface UploadProgressProps {
  state: UploadState;
  progress?: number;
  width?: number;
  height?: number;
}
export function UploadProgress({
  state,
  progress = 0,
  width = 160,
  height = 6,
}: UploadProgressProps) {
  const filled =
    state === 'uploading' ? Math.max(0, Math.min(100, progress)) : 0;
  const color =
    state === 'uploading' ? tokens.color.info : tokens.color.border;
  return (
    <View
      style={[
        {
          width,
          height,
          backgroundColor: tokens.color.border,
          borderRadius: height / 2,
          overflow: 'hidden',
        },
      ]}
    >
      <View
        style={{
          width: `${filled}%`,
          height: '100%',
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* StorageDonut                                                       */
/* ------------------------------------------------------------------ */

interface StorageDonutProps {
  value: number; // 0-100
  caption: string;
  size?: number;
}
export function StorageDonut({ value, caption, size = 120 }: StorageDonutProps) {
  let ringColor: string = tokens.color.primaryText;
  if (value >= 95) ringColor = tokens.color.danger;
  else if (value >= 80) ringColor = tokens.color.warning;

  const radius = (size - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, value)) / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={tokens.color.border}
          strokeWidth={8}
          fill="none"
        />
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={ringColor}
          strokeWidth={8}
          fill="none"
          strokeDasharray={circumference.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
          strokeLinecap="round"
        />
      </Svg>
      <AppText
        variant="title"
        style={{
          fontFamily: fonts.heading as FontName,
          color: ringColor,
          marginTop: tokens.space[8],
        }}
      >
        {Math.round(value)}%
      </AppText>
      <AppText variant="caption">{caption}</AppText>
    </View>
  );
}
