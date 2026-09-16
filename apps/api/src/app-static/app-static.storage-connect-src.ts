// Builds CSP connect-src for direct-upload to object storage (ADR-032 R3).
// Validates all values to prevent CSP-directive injection.

type StorageEnv = {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET_NAME?: string;
  AWS_REGION?: string;
  AZURE_BLOB_ENDPOINT?: string;
};

/**
 * Resolve a URL to its origin, or null if unusable. `new URL("file:///x")`
 * does NOT throw — it returns the *string* `"null"`, which in `connect-src`
 * becomes an unquoted `null` source matching sandboxed/`data:` documents.
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

// Object-storage origins for CSP connect-src: explicit S3_ENDPOINT, AWS
// S3 by region, or AZURE_BLOB_ENDPOINT. BYOC per-org endpoints excluded.
export const buildStorageConnectSrc = (env: StorageEnv): string[] => {
  const origins = new Set<string>();

  const endpointOrigin = safeOrigin(env.S3_ENDPOINT);
  const hasAwsS3Env = Boolean(
    env.S3_ENDPOINT || env.S3_REGION || env.S3_BUCKET_NAME || env.AWS_REGION,
  );
  if (endpointOrigin) {
    origins.add(endpointOrigin);
  } else if (hasAwsS3Env) {
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
