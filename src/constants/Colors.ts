/**
 * Clean, minimal, modern mobile color palette
 */

export const Colors = {
  light: {
    primary: '#2563EB', // Modern Indigo/Blue
    primaryLight: '#EFF6FF',
    primaryDark: '#1D4ED8',
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceSubtle: '#F1F5F9',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    text: '#0F172A',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    tabBarBackground: '#FFFFFF',
    tabBarBorder: '#E2E8F0',
    tabBarActive: '#2563EB',
    tabBarInactive: '#94A3B8',
    status: {
      active: '#10B981', // Emerald
      activeBg: '#ECFDF5',
      pending: '#F59E0B', // Amber
      pendingBg: '#FFFBEB',
      completed: '#3B82F6', // Blue
      completedBg: '#EFF6FF',
      expired: '#EF4444', // Red
      expiredBg: '#FEF2F2',
    },
    danger: '#DC2626',
    dangerBg: '#FEE2E2',
    cardShadow: 'rgba(0, 0, 0, 0.04)',
  },
  dark: {
    primary: '#3B82F6',
    primaryLight: '#1E3A8A',
    primaryDark: '#60A5FA',
    background: '#0B0F19',
    surface: '#151D2F',
    surfaceSubtle: '#1E293B',
    border: '#243049',
    borderStrong: '#334155',
    text: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    tabBarBackground: '#111827',
    tabBarBorder: '#1F2937',
    tabBarActive: '#60A5FA',
    tabBarInactive: '#6B7280',
    status: {
      active: '#34D399',
      activeBg: '#064E3B',
      pending: '#FBBF24',
      pendingBg: '#78350F',
      completed: '#60A5FA',
      completedBg: '#1E3A8A',
      expired: '#F87171',
      expiredBg: '#7F1D1D',
    },
    danger: '#EF4444',
    dangerBg: '#450A0A',
    cardShadow: 'rgba(0, 0, 0, 0.3)',
  },
} as const;

export type ThemeColors = typeof Colors.light;
