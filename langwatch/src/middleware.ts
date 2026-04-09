import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Runtime middleware that sets security headers per-request.
 *
 * Moved from next.config.mjs `headers()` (which is evaluated at build time)
 * so that the DISABLE_HTTPS_HEADERS env var takes effect at runtime —
 * critical for pre-built Docker images deployed on HTTP intranets.
 *
 * When DISABLE_HTTPS_HEADERS=true:
 *   - CSP `upgrade-insecure-requests` directive is omitted
 *   - HSTS `Strict-Transport-Security` header is omitted
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const isProduction =
    process.env.NODE_ENV !== "development" &&
    process.env.NODE_ENV !== "test";
  const disableHttpsHeaders =
    process.env.DISABLE_HTTPS_HEADERS === "true";

  const enforceHttps = isProduction && !disableHttpsHeaders;

  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev",
    "img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://*.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(enforceHttps ? ["upgrade-insecure-requests"] : []),
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");

  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Content-Type-Options", "nosniff");

  if (enforceHttps) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
}

/**
 * Apply middleware to all routes.
 * Exclude Next.js internals and static files.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
