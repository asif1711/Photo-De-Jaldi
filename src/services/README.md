# Backend Service Architecture

This directory establishes the architectural boundaries for Photo De Jaldi's backend services.

## Service Boundaries

1. **`api.ts`** (Cloudflare Workers API Client)
   - Exposes RESTful endpoints for bucket lifecycle management:
     - `createBucket(payload)`
     - `getBucket(bucketId)`
     - `listUserBuckets()`
     - `listInvitedBuckets()`
     - `inviteMember(bucketId, email)`
     - `markDownloadComplete(bucketId)`
   - Cloudflare Workers coordinates bucket cleanup when:
     - All invited members have completed downloads (`hasDownloadedAll === true`).
     - Expiry time is reached (via scheduled Worker CRON trigger).

2. **`supabase.ts`** (Supabase Client - Implemented in Stage 1)
   - Handles user registration (`signUpWithEmail`) and authentication (`signInWithEmail`).
   - Session persistence configured with React Native `@react-native-async-storage/async-storage`.
   - Real-time authentication state synchronization (`onAuthStateChange`).
   - Secure: Only public anon key is used; service role key is NEVER included in client.

3. **`storage.ts`** (Cloudflare R2 Object Storage)
   - Handles private, zero-egress file storage.
   - Pre-signed URLs for file uploads and downloads are minted securely by Cloudflare Workers.
   - R2 storage credentials are NEVER exposed to the mobile client.

*Implementation of these services will occur in subsequent phases after architectural review.*
