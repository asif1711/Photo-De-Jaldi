/**
 * Supabase Client and Authentication Service
 *
 * Implements persistent session management using React Native AsyncStorage,
 * email/password authentication, and auth state subscription.
 *
 * NOTE: Never expose the Supabase service-role key in the mobile application.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  createClient,
  SupabaseClient,
  User,
  Session,
  AuthChangeEvent,
  Subscription,
} from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

/**
 * Checks if Supabase credentials in the environment are present and syntactically valid.
 */
export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    (supabaseUrl.startsWith('https://') || supabaseUrl.startsWith('http://'))
  );
};

// Safe storage adapter to prevent SSR window reference errors on web/node pre-rendering
const storageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    return AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    return AsyncStorage.removeItem(key);
  },
};

// Use a safe placeholder URL if unconfigured so module evaluation doesn't crash the entire app
const resolvedUrl = isSupabaseConfigured() ? supabaseUrl : 'https://placeholder.supabase.co';
const resolvedKey = isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-key';

export const supabase: SupabaseClient = createClient(resolvedUrl, resolvedKey, {
  auth: {
    storage: storageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export interface AuthResponse {
  user: User | null;
  session: Session | null;
  error: string | null;
}

/**
 * Register a new user with email and password.
 */
export async function signUpWithEmail(email: string, password: string): Promise<AuthResponse> {
  if (!isSupabaseConfigured()) {
    return {
      user: null,
      session: null,
      error: 'Supabase configuration is missing or invalid. Please check EXPO_PUBLIC_SUPABASE_URL in your .env file.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      return { user: null, session: null, error: error.message };
    }

    return {
      user: data.user,
      session: data.session,
      error: null,
    };
  } catch (err: any) {
    return {
      user: null,
      session: null,
      error: err?.message || 'An unexpected error occurred during registration.',
    };
  }
}

/**
 * Sign in existing user with email and password.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthResponse> {
  if (!isSupabaseConfigured()) {
    return {
      user: null,
      session: null,
      error: 'Supabase configuration is missing or invalid. Please check EXPO_PUBLIC_SUPABASE_URL in your .env file.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { user: null, session: null, error: error.message };
    }

    return {
      user: data.user,
      session: data.session,
      error: null,
    };
  } catch (err: any) {
    return {
      user: null,
      session: null,
      error: err?.message || 'An unexpected error occurred during login.',
    };
  }
}

/**
 * Sign out the currently authenticated user and clear stored session.
 */
export async function signOut(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { error: null };
  }

  try {
    const { error } = await supabase.auth.signOut();
    return { error: error ? error.message : null };
  } catch (err: any) {
    return { error: err?.message || 'Failed to sign out.' };
  }
}

/**
 * Get current persistent session from storage.
 */
export async function getStoredSession(): Promise<{ session: Session | null; error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { session: null, error: null };
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      return { session: null, error: error.message };
    }
    return { session: data.session, error: null };
  } catch (err: any) {
    return { session: null, error: err?.message || 'Failed to retrieve session.' };
  }
}

/**
 * Subscribe to authentication state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, etc.).
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): { subscription: Subscription } {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return { subscription: data.subscription };
}
