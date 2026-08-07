import { buildStorageConnectSrc } from "./buildStorageConnectSrc";

type SecurityHeaderEnvironment = Partial<
  Record<
    | "AWS_REGION"
    | "AZURE_BLOB_ENDPOINT"
    | "S3_BUCKET_NAME"
    | "S3_ENDPOINT"
    | "S3_REGION",
    string
  >
>;

export function buildSecurityHeaders({
  dev,
  environment = process.env,
  assetOrigin = null,
}: {
  dev: boolean;
  environment?: SecurityHeaderEnvironment;
  /**
   * ADR-086: origin serving content-hashed assets when LANGWATCH_ASSET_BASE is
   * set. Admitted into every fetch directive the browser needs to load chunks,
   * styles, fonts, images and workers from it. Null for same-origin serving.
   */
  assetOrigin?: string | null;
}): Record<string, string> {
  const cdn = assetOrigin ? ` ${assetOrigin}` : "";

  const cspHeader = [
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
    `connect-src 'self' ${buildStorageConnectSrc(environment).join(
      " ",
    )} https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");

  return {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy":
      "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    ...(!dev ? { "Content-Security-Policy": cspHeader } : {}),
    ...(!dev
      ? {
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        }
      : {}),
  };
}
