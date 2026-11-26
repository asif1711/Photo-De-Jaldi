/**
 * Recognizes explicit daily download-cap details in S3-compatible error bodies.
 */
export function isDailyCapError(status: number, body: string): boolean {
  if (status !== 403) return false;
  const normalized = body.toLowerCase();
  return (
    normalized.includes('download_cap_exceeded') ||
    normalized.includes('daily download cap') ||
    normalized.includes('download bandwidth cap')
  );
}
