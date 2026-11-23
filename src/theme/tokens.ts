/**
 * Dark-only design tokens for Photo De Jaldi.
 * No light theme, no useColorScheme branching.
 */

export const tokens = {
  color: {
    // Neutrals
    bg: '#0B0E0C',
    surface: '#131815',
    surfaceRaised: '#1B221E',
    border: '#26302B',
    text: '#E8EEEA',
    textMuted: '#9AA7A0',
    textDisabled: '#5E6A64',

    // Primary — solid fills only (primaryText is green for text/icons/progress on dark)
    primary: '#008000',
    onPrimary: '#FFFFFF',
    primaryText: '#4CBB17',
    primarySoft: 'rgba(76, 187, 23, 0.14)',

    info: '#22D3EE',
    infoSoft: 'rgba(34, 211, 238, 0.14)',

    warning: '#FBBF24',
    warningSoft: 'rgba(251, 191, 36, 0.14)',

    danger: '#F87171',
    dangerSoft: 'rgba(248, 113, 113, 0.14)',
  },
  radius: {
    card: 20,
    pill: 999,
  },
  space: {
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    24: 24,
  },
  borderWidth: 1,
} as const;

export type Tokens = typeof tokens;

export const fonts = {
  body: 'GoogleSansFlex_400Regular',
  label: 'GoogleSansFlex_500Medium',
  title: 'GoogleSansFlex_600SemiBold',
  heading: 'Fraunces_600SemiBold',
  headingItalic: 'Fraunces_600SemiBold_Italic',
} as const;

export type FontName = (typeof fonts)[keyof typeof fonts];
