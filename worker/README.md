# Photo De Jaldi Cloudflare Worker Backend

This Cloudflare Worker mediates all Backblaze B2 interactions, presigned URL generation, and global quota enforcement for Photo De Jaldi.

## Architecture

- **Private B2 Access**: S3-compatible Backblaze B2 client (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
- **Direct Transfers**: Mobile clients upload and download directly to/from B2 via short-lived presigned URLs.
- **Atomic Global Quota**: Enforces a strict 9 GB (9,000,000,000 bytes) shared limit across all users and buckets before authorizing uploads.
- **Supabase Authentication**: Validates user JWT on every request before verifying bucket ownership or membership.

---

## Configuration & Secrets

### 1. Worker Environment Variables (`wrangler.toml`)

The following public variables are defined in `wrangler.toml`:

```toml
[vars]
B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
B2_BUCKET_NAME = "photo-de-jaldi-storage"
B2_REGION = "us-east-005"
SUPABASE_URL = "https://unobllenymfzafrwiuvm.supabase.co"
MAX_STORAGE_BYTES = "9000000000"
```

### 2. Setting Worker Secrets via Wrangler CLI

Run these commands inside the `worker/` directory to configure secrets securely without committing credentials:

```bash
# 1. Backblaze B2 Key ID (Application Key ID)
npx wrangler secret put B2_KEY_ID

# 2. Backblaze B2 Application Key (Secret Key)
npx wrangler secret put B2_APPLICATION_KEY

# 3. Supabase Service Role Key (from Supabase Dashboard -> Settings -> API)
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

> [!NOTE]
> For local development with `wrangler dev`, you can create a local `worker/.dev.vars` file (ignored by Git):
> ```env
> B2_KEY_ID="your_b2_key_id"
> B2_APPLICATION_KEY="your_b2_application_key"
> SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"
> ```

---

## Running and Deploying

```bash
# Install worker dependencies
cd worker
npm install

# Run locally on http://127.0.0.1:8787
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

---

## Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/storage/usage` | Returns global capacity, committed bytes, reserved bytes, remaining quota, file status breakdown, and estimated download bytes today. |
| `POST` | `/uploads/authorize` | Atomically reserves quota and generates presigned PUT URL (10 min expiry). |
| `POST` | `/uploads/finalize` | Verifies physical B2 object via HeadObject and commits quota in Supabase. |
| `POST` | `/uploads/abort` | Cancels incomplete upload, deletes partial B2 object, and releases reserved quota. |
| `POST` | `/downloads/authorize` | Verifies access and generates presigned GET URL (5 min expiry). |
| `GET` | `/buckets/:id/files` | Lists confirmed uploaded files in the bucket. |
| `DELETE` | `/files/:id` | Physically deletes object from B2 first, then releases committed quota. |
| `POST` | `/storage/reconcile` | Synchronizes Supabase accounting with unexpired active reservations. |
