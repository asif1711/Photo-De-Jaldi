/**
 * Application configuration
 *
 * NOTE: Never place API keys, private tokens, or storage secrets here.
 * All secure operations (presigned URLs, quota enforcement, Supabase service roles)
 * are handled through the Cloudflare Workers backend.
 */

export const AppConfig = {
  appName: 'Photo De Jaldi',
  version: '1.0.0',
  description: 'Lightweight, temporary file-sharing for Android and iOS',

  // Soft client-side hints (server enforces hard limits)
  limits: {
    // Global quota enforced server-side: 9,000,000,000 bytes
    globalStorageLimitBytes: 9_000_000_000,
    // Warn user in UI at these utilization thresholds
    warningThresholds: [0.7, 0.8, 0.9, 1.0],
    defaultExpiryHours: 24,
    maxExpiryHours: 168,
  },

  // Backend endpoints configured via Expo public environment variables
  endpoints: {
    // Cloudflare Workers API — set EXPO_PUBLIC_API_URL in your .env file
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  },
} as const;
