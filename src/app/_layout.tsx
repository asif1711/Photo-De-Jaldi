import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { AuthProvider, useAuth } from '@/context/AuthContext';

SplashScreen.preventAutoHideAsync();

function NavigationRoot() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[isDark ? 'dark' : 'light'];

  useEffect(() => {
    if (isLoading) return;

    // Check if the current route is within the (auth) group
    const inAuthGroup = (segments as string[])[0] === '(auth)';

    if (!session && !inAuthGroup) {
      // Unauthenticated users are redirected to login
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      // Authenticated users in auth screens are redirected to the home screen
      router.replace('/');
    }
  }, [session, segments, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '600',
        },
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen
        name="bucket/create"
        options={{
          headerShown: true,
          presentation: 'card',
          title: 'Create Bucket',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="bucket/[id]"
        options={{
          headerShown: true,
          presentation: 'card',
          title: 'Bucket Details',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen name="+not-found" options={{ title: 'Not Found' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthProvider>
        <NavigationRoot />
      </AuthProvider>
    </ThemeProvider>
  );
}
