/**
 * Drop-in react-native Text/TextInput wrappers.
 *
 * These always resolve to a registered Google Sans Flex / Fraunces family and
 * strip fontWeight/fontStyle so the named families load on Android (a
 * fontWeight alongside a multi-weight family falls back to the system font).
 * All other props and refs are passed through unchanged.
 */

import { forwardRef } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { tokens, fonts } from './tokens';

type RNTextProps = React.ComponentProps<typeof RNText>;
type RNTextInputProps = React.ComponentProps<typeof RNTextInput>;
type RNTextInstance = typeof RNText extends new (...args: any[]) => infer I ? I : never;

const FONT_MAP: Record<string, string> = {
  '400': fonts.body,
  normal: fonts.body,
  '500': fonts.label,
  '600': fonts.title,
  '700': fonts.title,
  bold: fonts.title,
};

function resolveFamily(style: any): string {
  const flat = style ? StyleSheet.flatten(style) : null;
  if (!flat) return fonts.body;
  const explicit = flat.fontFamily;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  const weight = flat.fontWeight;
  return FONT_MAP[weight] ?? fonts.body;
}

function stripWeight(style: any): any {
  const flat = style ? StyleSheet.flatten(style) : null;
  if (!flat) return undefined;
  const copy = { ...flat };
  delete copy.fontWeight;
  delete copy.fontStyle;
  return copy;
}

export const Text = forwardRef<RNTextInstance, RNTextProps>(({ style, ...props }, ref) => {
  const family = resolveFamily(style);
  return (
    <RNText
      ref={ref}
      style={[{ fontFamily: family, color: tokens.color.text }, stripWeight(style)]}
      {...props}
    />
  );
});
Text.displayName = 'Text';

export const TextInput = forwardRef<RNTextInstance, RNTextInputProps>(
  ({ style, ...props }, ref) => {
    const family = resolveFamily(style);
    return (
      <RNTextInput
        ref={ref}
        style={[{ fontFamily: family, color: tokens.color.text }, stripWeight(style)]}
        placeholderTextColor={tokens.color.textMuted}
        selectionColor={tokens.color.primaryText}
        keyboardAppearance="dark"
        {...props}
      />
    );
  },
);
TextInput.displayName = 'TextInput';