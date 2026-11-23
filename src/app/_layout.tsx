import { AuthProvider, useAuth } from '@/context/AuthContext';
import {
  Fraunces_400Regular,
  Fraunces_600SemiBold,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import {
  GoogleSansFlex_400Regular,
  GoogleSansFlex_500Medium,
  GoogleSansFlex_600SemiBold,
} from '@expo-google-fonts/google-sans-flex';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

SplashScreen.preventAutoHideAsync();

function NavigationRoot() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = (segments as string[])[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
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
          backgroundColor: '#0B0E0C',
        }}>
        <ActivityIndicator size="large" color="#4CBB17" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: '#131815',
        },
        headerTintColor: '#E8EEEA',
        headerTitleStyle: {
          fontFamily: 'GoogleSansFlex_600SemiBold',
        },
        contentStyle: {
          backgroundColor: '#0B0E0C',
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
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    GoogleSansFlex_400Regular,
    GoogleSansFlex_500Medium,
    GoogleSansFlex_600SemiBold,
  });

  // Keep the splash until fonts are ready. If loading fails, continue with the system font.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <NavigationRoot />
      </AuthProvider>
    </ThemeProvider>
  );
}