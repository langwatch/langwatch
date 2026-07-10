import { buildStorageConnectSrc } from "./buildStorageConnectSrc";

/**
 * Build the production Content-Security-Policy header (migrated from
 * next.config.mjs). Pure so it can be unit-tested without booting the server —
 * the caller passes the request-independent inputs.
 *
 * `assetOrigin` (ADR-038): when content-hashed assets are served from an external
 * CDN (LANGWATCH_ASSET_BASE set), that origin is admitted into every fetch
 * directive the browser needs to load chunks / styles / fonts / images / workers
 * from it. Null for same-origin self-host serving, where nothing is added.
 */
export function buildContentSecurityPolicy({
  dev,
  assetOrigin,
  storageEnv,
}: {
  dev: boolean;
  assetOrigin: string | null;
  storageEnv: {
    S3_ENDPOINT?: string;
    S3_REGION?: string;
    S3_BUCKET_NAME?: string;
    AWS_REGION?: string;
    AZURE_BLOB_ENDPOINT?: string;
  };
}): string {
  const cdn = assetOrigin ? ` ${assetOrigin}` : "";
  const storageConnectSrc = buildStorageConnectSrc(storageEnv).join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev https://fonts.googleapis.com https://unpkg.com${cdn}`,
    `img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://*.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    `font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev https://fonts.gstatic.com${cdn}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!dev ? ["upgrade-insecure-requests"] : []),
    `worker-src 'self' blob:${cdn}`,
    // ADR-032: allow the browser's presigned PUT to object storage (derived
    // from the same env the S3 client uses) — without it the CSP blocks the
    // upload before it leaves the page and the drawer silently falls back.
    `connect-src 'self' ${storageConnectSrc} https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");
}
