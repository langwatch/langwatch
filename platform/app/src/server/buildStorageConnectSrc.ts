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
 *
 * SECURITY: every value here is interpolated into a security header, so it is
 * validated/sanitised before emission — an env value containing `;`, whitespace,
 * or an opaque origin must never inject extra CSP directives or source tokens.
 */

type StorageEnv = {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET_NAME?: string;
  AWS_REGION?: string;
  AZURE_BLOB_ENDPOINT?: string;
};

/**
 * Resolve a URL to its origin, or null if unusable. `new URL("file:///x")` (and
 * other opaque-origin schemes) does NOT throw — it returns the *string* `"null"`,
 * which if emitted into `connect-src` becomes an unquoted `null` source that
 * matches null-origin documents (sandboxed iframes, `data:` URIs) and silently
 * weakens the policy. Reject it explicitly.
 */
const safeOrigin = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    // A malformed endpoint must never break header construction.
    return null;
  }
};

/** AWS region tokens are `[a-z0-9-]` only — anything else can't be a real region
 * and, interpolated into the header, would inject CSP directives/tokens. */
const AWS_REGION_RE = /^[a-z0-9-]+$/;

/**
 * The object-storage origins to add to the CSP `connect-src` directive.
 *
 * - An explicit `S3_ENDPOINT` (R2 / MinIO / custom, or the bucket-scoped AWS
 *   endpoint prod uses) — the presigned URL's origin is exactly this, and the
 *   S3 client runs `forcePathStyle`, so the host never gets a bucket subdomain.
 * - No endpoint but AWS is in use (region / bucket / `AWS_REGION` set, e.g.
 *   IRSA): the SDK targets `s3.<region>.amazonaws.com` (path-style) or
 *   `<bucket>.s3.<region>…` (virtual-hosted), so allow both forms for the
 *   validated region; fall back to a broad AWS S3 wildcard only when the region
 *   is unknown/invalid. The AWS branch is gated on an AWS signal so a pure-Azure
 *   or local-FS deployment never gets a gratuitous `amazonaws.com` source.
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
  } else if (
    env.S3_ENDPOINT ||
    env.S3_REGION ||
    env.S3_BUCKET_NAME ||
    env.AWS_REGION
  ) {
    // AWS S3 is plausibly the backend (some AWS/S3 env present) but no usable
    // explicit endpoint — emit the AWS origin(s) for the configured region.
    const region = (env.S3_REGION ?? env.AWS_REGION)?.trim();
    if (region && AWS_REGION_RE.test(region)) {
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
