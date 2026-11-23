import { useColorScheme as _useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';

export function useColorScheme(): 'light' | 'dark' {
  const scheme = _useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const scheme = useColorScheme();
  return {
    isDark: scheme === 'dark',
    colors: Colors[scheme],
    scheme,
  };
}
