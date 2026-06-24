/**
 * ADR-032 R3: the browser uploads a dataset file straight to object storage via
 * a presigned PUT. In production the app sends a Content-Security-Policy, and
 * its `connect-src` directive must allow the storage origin — otherwise the
 * browser refuses the `fetch` BEFORE it leaves the page. That surfaces as an
 * opaque `TypeError` (looks like a CORS failure, but the bucket CORS is fine),
 * the drawer falls back to the in-browser parse path, and large uploads dead-end
 * with the misleading "requires object storage" error.
 *
 * The allowed origin(s) are derived from the SAME env the S3 client
 * (`createS3Client`) uses, so the CSP always tracks the configured
 * bucket/region/endpoint instead of drifting from a hardcoded list.
 */

type StorageEnv = {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  AZURE_BLOB_ENDPOINT?: string;
};

const safeOrigin = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    // A malformed endpoint must never break header construction.
    return null;
  }
};

/**
 * The object-storage origins to add to the CSP `connect-src` directive.
 *
 * - An explicit `S3_ENDPOINT` (R2 / MinIO / custom, or the bucket-scoped AWS
 *   endpoint prod uses) — the presigned URL's origin is exactly this, and the
 *   S3 client runs `forcePathStyle`, so the host never gets a bucket subdomain.
 * - No endpoint (plain AWS, e.g. IRSA): the SDK targets
 *   `s3.<region>.amazonaws.com` (path-style) or `<bucket>.s3.<region>…`
 *   (virtual-hosted), so allow both forms for the configured region; fall back
 *   to a broad AWS S3 wildcard only when even the region is unknown.
 * - `AZURE_BLOB_ENDPOINT` for the Azure alternative.
 *
 * BYOC per-org endpoints are intentionally NOT covered here — a static CSP
 * can't enumerate dynamic per-tenant buckets; that ships with the deferred
 * per-org upload route.
 */
export const buildStorageConnectSrc = (env: StorageEnv): string[] => {
  const origins = new Set<string>();

  const endpointOrigin = safeOrigin(env.S3_ENDPOINT);
  if (endpointOrigin) {
    origins.add(endpointOrigin);
  } else {
    const region = env.S3_REGION?.trim();
    if (region) {
      origins.add(`https://s3.${region}.amazonaws.com`);
      origins.add(`https://*.s3.${region}.amazonaws.com`);
    } else {
      origins.add("https://*.amazonaws.com");
    }
  }

  const azureOrigin = safeOrigin(env.AZURE_BLOB_ENDPOINT);
  if (azureOrigin) origins.add(azureOrigin);

  return [...origins];
};
