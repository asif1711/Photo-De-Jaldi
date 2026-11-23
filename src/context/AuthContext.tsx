import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import {
  signInWithEmail,
  signUpWithEmail,
  signOut as supabaseSignOut,
  getStoredSession,
  onAuthStateChange,
  isSupabaseConfigured,
} from '@/services/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error: string | null }>;
  signUp: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error: string | null; needsEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  isConfigured: false,
  signIn: async () => ({ success: false, error: 'AuthContext not initialized' }),
  signUp: async () => ({ success: false, error: 'AuthContext not initialized' }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const { session: storedSession } = await getStoredSession();
        if (isMounted) {
          setSession(storedSession);
          setUser(storedSession?.user ?? null);
        }
      } catch (err) {
        console.warn('Failed to restore Supabase session:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    // Listen for auth state changes (login, logout, token refresh)
    const { subscription } = onAuthStateChange(
      (_event: AuthChangeEvent, updatedSession: Session | null) => {
        if (isMounted) {
          setSession(updatedSession);
          setUser(updatedSession?.user ?? null);
          setIsLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await signInWithEmail(email, password);
    if (res.error) {
      return { success: false, error: res.error };
    }
    setSession(res.session);
    setUser(res.user);
    return { success: true, error: null };
  };

  const signUp = async (email: string, password: string) => {
    const res = await signUpWithEmail(email, password);
    if (res.error) {
      return { success: false, error: res.error };
    }
    setSession(res.session);
    setUser(res.user);
    // If Supabase has email confirmation enabled, session will be null on signup
    const needsEmailConfirmation = !res.session && Boolean(res.user);
    return { success: true, error: null, needsEmailConfirmation };
  };

  const signOut = async () => {
    await supabaseSignOut();
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: Boolean(session?.user),
        isConfigured: configured,
        signIn,
        signUp,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
