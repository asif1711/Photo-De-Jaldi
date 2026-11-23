import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  UploadPartCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Env } from './types';

// ============================================================================
// AWS Signature V4 Signing (Cloudflare Workers compatible)
// Cloudflare Workers does not provide DOMParser, which @aws-sdk/client-s3
// requires for XML response deserialization. We use fetch + Signature V4
// signing instead, with lightweight regex-based XML parsing.
// Web Crypto API (crypto.subtle) is used instead of Node.js crypto to avoid
// type conflicts with @cloudflare/workers-types.
// ============================================================================

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const encoder = new TextEncoder();

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const input =
    typeof data === 'string' ? encoder.encode(data) : data;
  const buffer = input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const hexArray = Array.from(new Uint8Array(hash));
  return hexArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const keyBuffer = key.buffer.slice(
    key.byteOffset,
    key.byteOffset + key.byteLength
  ) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(data)
  );
  return new Uint8Array(signature);
}

async function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<Uint8Array> {
  const kDate = await hmacSha256(encoder.encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function iso8601(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function shortIso(date: Date): string {
  return iso8601(date).slice(0, 8);
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function signV4Request(
  method: string,
  url: URL,
  headers: Record<string, string>,
  bodyHash: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string
): Promise<Record<string, string>> {
  const now = new Date();
  const amzDate = iso8601(now);
  const dateStamp = shortIso(now);

  const lowerHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    lowerHeaders[key.toLowerCase()] = value;
  }
  lowerHeaders['host'] = url.host;
  lowerHeaders['x-amz-date'] = amzDate;

  const canonicalHeaders = Object.entries(lowerHeaders)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}:${value}`)
    .join('\n');

  const signedHeaders = Object.keys(lowerHeaders).sort().join(';');
  const canonicalQueryString = Array.from(url.searchParams.entries())
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB
        ? valueA < valueB
          ? -1
          : valueA > valueB
            ? 1
            : 0
        : keyA < keyB
          ? -1
          : keyA > keyB
            ? 1
            : 0
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQueryString,
    canonicalHeaders + '\n',
    signedHeaders,
    bodyHash,
  ].join('\n');

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  const stringToSign = [
    ALGORITHM,
    amzDate,
    `${dateStamp}/${region}/${SERVICE}/aws4_request`,
    hashedCanonicalRequest,
  ].join('\n');

  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region, SERVICE);
  const signature = await hmacSha256(signingKey, stringToSign);
  const signatureHex = Array.from(signature)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorization = [
    `${ALGORITHM} Credential=${accessKeyId}/${dateStamp}/${region}/${SERVICE}/aws4_request`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signatureHex}`,
  ].join(', ');

  return { ...lowerHeaders, authorization };
}

async function bodyToUint8Array(body: BodyInit | null): Promise<Uint8Array | null> {
  if (!body) return null;
  if (typeof body === 'string') {
    return new Uint8Array(encoder.encode(body));
  }
  const arrayBuffer = await (body as Blob).arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function fetchB2(
  env: Env,
  method: string,
  path: string,
  query: Record<string, string | number> | null,
  body: BodyInit | null,
  contentType: string | null,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const url = new URL(`${env.B2_ENDPOINT}/${env.B2_BUCKET_NAME}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.append(key, String(value));
    }
  }

  const bodyBytes = await bodyToUint8Array(body);
  const bodyHash = bodyBytes ? await sha256Hex(bodyBytes) : EMPTY_BODY_SHA256;

  // Backblaze B2 requires x-amz-content-sha256 to be present and signed.
  const headers: Record<string, string> = {
    'x-amz-content-sha256': bodyHash,
    ...extraHeaders,
  };
  if (contentType) headers['content-type'] = contentType;

  const signedHeaders = await signV4Request(
    method,
    url,
    headers,
    bodyHash,
    env.B2_KEY_ID,
    env.B2_APPLICATION_KEY,
    env.B2_REGION
  );

  const response = await fetch(url.toString(), {
    method,
    headers: signedHeaders,
    body,
  });

  return response;
}

// ============================================================================
// Lightweight XML parsing (no DOMParser required)
// ============================================================================

function extractXmlTag(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function parseListPartsXml(
  xml: string
): { partNumber: number; eTag: string; size: number }[] {
  const parts: { partNumber: number; eTag: string; size: number }[] = [];
  const partRegex = /<Part>([\s\S]*?)<\/Part>/gi;
  let match: RegExpExecArray | null;
  while ((match = partRegex.exec(xml)) !== null) {
    const partXml = match[1];
    const partNumberStr = extractXmlTag(partXml, 'PartNumber');
    const eTag = extractXmlTag(partXml, 'ETag');
    const sizeStr = extractXmlTag(partXml, 'Size');
    if (partNumberStr && eTag) {
      parts.push({
        partNumber: parseInt(partNumberStr, 10),
        eTag: eTag.replace(/"/g, ''),
        size: sizeStr ? parseInt(sizeStr, 10) : 0,
      });
    }
  }
  return parts;
}

function extractErrorMessage(xml: string): string {
  const message = extractXmlTag(xml, 'Message');
  const code = extractXmlTag(xml, 'Code');
  if (message && code) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;
  return 'Unknown B2 error';
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_PART_SIZE = 5 * 1024 * 1024;

export function calculateTotalParts(fileSize: number, partSize: number): number {
  return Math.ceil(fileSize / partSize);
}

export function calculatePartSize(
  fileSize: number,
  partSize: number,
  partNumber: number
): number {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, fileSize);
  return end - start;
}

// ============================================================================
// Presigned URLs (uses @aws-sdk/s3-request-presigner only - no XML parsing)
// These generate URL strings; they do not make HTTP requests or parse XML.
// ============================================================================

export async function generateUploadPresignedUrl(
  env: Env,
  objectKey: string,
  contentType: string,
  expiresIn = 600
): Promise<string> {
  const client = getB2SigningClient(env);
  const command = new PutObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: objectKey,
    ContentType: contentType || 'application/octet-stream',
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function generateDownloadPresignedUrl(
  env: Env,
  objectKey: string,
  filename: string,
  expiresIn = 300
): Promise<string> {
  const client = getB2SigningClient(env);
  const safeFilename = encodeURIComponent(filename);
  const command = new GetObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function generatePartPresignedUrl(
  env: Env,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 600
): Promise<string> {
  const client = getB2SigningClient(env);
  const command = new UploadPartCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function generateListObjectsPresignedUrl(
  env: Env,
  prefix: string,
  maxKeys: number,
  continuationToken?: string
): Promise<string> {
  const client = getB2SigningClient(env);
  const command = new ListObjectsV2Command({
    Bucket: env.B2_BUCKET_NAME,
    Prefix: prefix,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
  });

  return getSignedUrl(client, command, { expiresIn: 300 });
}

function getB2SigningClient(env: Env): S3Client {
  // S3Client is used ONLY for getSignedUrl configuration (region, endpoint, credentials).
  // client.send() is never called, so DOMParser is never triggered.
  return new S3Client({
    endpoint: env.B2_ENDPOINT,
    region: env.B2_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APPLICATION_KEY,
    },
  });
}

// ============================================================================
// S3 API operations (uses fetch + Signature V4 - no DOMParser)
// ============================================================================

export async function deleteB2Object(env: Env, objectKey: string): Promise<boolean> {
  const response = await fetchB2(env, 'DELETE', `/${objectKey}`, null, null, null);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `B2 delete object failed with HTTP ${response.status}: ${extractErrorMessage(body)}`
    );
  }
  return true;
}

export interface B2ListedObject {
  key: string;
  size: number;
  lastModified: string | null;
  etag?: string;
}

export interface B2ObjectList {
  objects: B2ListedObject[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 10))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function logB2ListFailure(
  status: string,
  body: string,
  requestId: string
): void {
  console.error(
    `[listB2Objects] failed status=${status} code=${extractXmlTag(body, 'Code') ?? 'n/a'} message=${extractXmlTag(body, 'Message') ?? 'n/a'} requestId=${requestId}`
  );
}

async function fetchListObjectsXml(
  env: Env,
  prefix: string,
  maxKeys: number,
  continuationToken?: string
): Promise<string> {
  const query: Record<string, string | number> = {
    'list-type': 2,
    prefix,
    'max-keys': maxKeys,
  };
  if (continuationToken) query['continuation-token'] = continuationToken;

  try {
    const response = await fetchB2(env, 'GET', '/', query, null, null);
    if (response.ok) return await response.text();

    const body = await response.text();
    logB2ListFailure(
      String(response.status),
      body,
      response.headers.get('x-amz-request-id') ?? '-'
    );
  } catch {
    logB2ListFailure('network', '', '-');
  }

  try {
    const signedUrl = await generateListObjectsPresignedUrl(
      env,
      prefix,
      maxKeys,
      continuationToken
    );
    const response = await fetch(signedUrl, { method: 'GET' });
    if (response.ok) return await response.text();

    const body = await response.text();
    logB2ListFailure(
      String(response.status),
      body,
      response.headers.get('x-amz-request-id') ?? '-'
    );
    throw new Error(`B2 list objects failed with HTTP ${response.status}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('B2 list objects failed')) {
      throw error;
    }
    logB2ListFailure('network', '', '-');
    throw new Error('B2 list objects request failed due to a network error.');
  }
}

export async function listB2Objects(
  env: Env,
  prefix: string,
  maxKeys = 1000,
  continuationToken?: string
): Promise<B2ObjectList> {
  const xml = await fetchListObjectsXml(env, prefix, maxKeys, continuationToken);
  const objects: B2ListedObject[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/gi;
  let match: RegExpExecArray | null;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const entry = match[1];
    const key = extractXmlTag(entry, 'Key');
    const size = extractXmlTag(entry, 'Size');
    if (!key || !size) continue;

    const parsedSize = Number.parseInt(size, 10);
    if (!Number.isFinite(parsedSize)) continue;
    const lastModified = extractXmlTag(entry, 'LastModified');
    const etag = extractXmlTag(entry, 'ETag');
    objects.push({
      key: decodeXmlEntities(key),
      size: parsedSize,
      lastModified: lastModified ? decodeXmlEntities(lastModified) : null,
      etag: etag ? decodeXmlEntities(etag).replace(/"/g, '') : undefined,
    });
  }

  const isTruncated = extractXmlTag(xml, 'IsTruncated')?.toLowerCase() === 'true';
  const nextToken = extractXmlTag(xml, 'NextContinuationToken');
  return {
    objects,
    isTruncated,
    nextContinuationToken: nextToken ? decodeXmlEntities(nextToken) : null,
  };
}

export async function verifyB2Object(
  env: Env,
  objectKey: string
): Promise<{ exists: boolean; size: number; checksum?: string }> {
  const result = await listB2Objects(env, objectKey, 1);
  const object = result.objects.find((candidate) => candidate.key === objectKey);
  if (!object) return { exists: false, size: 0 };

  return {
    exists: true,
    size: object.size,
    checksum: object.etag,
  };
}

export async function initiateMultipartUpload(
  env: Env,
  objectKey: string,
  contentType: string
): Promise<{ uploadId: string }> {
  const response = await fetchB2(
    env,
    'POST',
    `/${objectKey}`,
    { uploads: '' },
    null,
    contentType || 'application/octet-stream'
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `B2 initiate multipart upload failed with HTTP ${response.status}: ${extractErrorMessage(body)}`
    );
  }

  const xml = await response.text();
  const uploadId = extractXmlTag(xml, 'UploadId');
  if (!uploadId) {
    throw new Error('B2 initiate multipart upload response missing UploadId.');
  }

  return { uploadId };
}

export async function completeMultipartUpload(
  env: Env,
  objectKey: string,
  uploadId: string,
  parts: { ETag: string; PartNumber: number }[]
): Promise<{ etag: string }> {
  const partsXml = parts
    .map(
      (p) => `
    <Part>
      <PartNumber>${p.PartNumber}</PartNumber>
      <ETag>${p.ETag.startsWith('"') ? p.ETag : `"${p.ETag}"`}</ETag>
    </Part>`
    )
    .join('');

  const body = `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${partsXml}</CompleteMultipartUpload>`;

  const response = await fetchB2(
    env,
    'POST',
    `/${objectKey}`,
    { uploadId: uploadId },
    body,
    'application/xml'
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `B2 complete multipart upload failed with HTTP ${response.status}: ${extractErrorMessage(errorBody)}`
    );
  }

  const xml = await response.text();
  const etag = extractXmlTag(xml, 'ETag');
  if (!etag) {
    throw new Error('B2 complete multipart upload response missing ETag.');
  }

  return { etag: etag.replace(/"/g, '') };
}

export async function abortMultipartUpload(
  env: Env,
  objectKey: string,
  uploadId: string
): Promise<boolean> {
  const response = await fetchB2(
    env,
    'DELETE',
    `/${objectKey}`,
    { uploadId: uploadId },
    null,
    null
  );

  if (!response.ok && response.status !== 204 && response.status !== 200) {
    const body = await response.text();
    throw new Error(
      `B2 abort multipart upload failed with HTTP ${response.status}: ${extractErrorMessage(body)}`
    );
  }
  return true;
}

export async function listMultipartParts(
  env: Env,
  objectKey: string,
  uploadId: string
): Promise<{ partNumber: number; eTag: string; size: number }[]> {
  const response = await fetchB2(
    env,
    'GET',
    `/${objectKey}`,
    { uploadId: uploadId },
    null,
    null
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `B2 list parts failed with HTTP ${response.status}: ${extractErrorMessage(body)}`
    );
  }

  const xml = await response.text();
  return parseListPartsXml(xml);
}
