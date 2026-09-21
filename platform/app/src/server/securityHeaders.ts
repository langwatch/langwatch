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
    // blob: in script-src, not only worker-src: AudioWorklet.addModule() is a
    // script fetch, and the ElevenLabs browser client (1.23.x) registers its
    // rawAudioProcessor / audioConcatProcessor worklets from a blob: URL. Without
    // it the voice panel fails in production with "Failed to load the
    // rawAudioProcessor worklet module" while working in dev, where no CSP is
    // enforced (#7947).
    `script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev https://fonts.googleapis.com https://unpkg.com${cdn}`,
    `img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://*.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    `font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev https://fonts.gstatic.com${cdn}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!dev ? ["upgrade-insecure-requests"] : []),
    `worker-src 'self' blob:${cdn}`,
    // Voice agents: the browser talks to ElevenLabs directly over the signed
    // ConvAI websocket the platform mints (#7947).
    `connect-src 'self' ${buildStorageConnectSrc(environment).join(
      " ",
    )} https://api.elevenlabs.io wss://api.elevenlabs.io https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev${cdn}`,
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");

  return {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    // microphone=(self): the "Talk to it" voice panel captures audio on this
    // origin. microphone=() makes getUserMedia reject with NotAllowedError
    // without ever prompting, which reads as a user denial (#7947).
    "Permissions-Policy":
      "geolocation=(), microphone=(self), camera=(), payment=(), usb=()",
    // Dev enforces nothing but reports the same policy, so a directive that
    // would break production shows up as a console violation on the first
    // local run instead of after deploy (#7947).
    ...(dev
      ? { "Content-Security-Policy-Report-Only": cspHeader }
      : { "Content-Security-Policy": cspHeader }),
    ...(!dev
      ? {
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        }
      : {}),
  };
}
