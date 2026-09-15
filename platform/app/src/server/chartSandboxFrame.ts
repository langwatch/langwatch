/**
 * The sandboxed chart-frame document's own route and response headers.
 *
 * Why this is separate from `securityHeaders.ts`: a `srcdoc` iframe inherits
 * the parent page's Content-Security-Policy, so the app-wide policy (no
 * unpkg.com / esm.sh in `script-src`) blocked the frame's React / Recharts /
 * Babel bundles in production. Serving the document from its own route lets it
 * carry a deliberately permissive policy that REPLACES the app-wide one for
 * that one response, so a widget author may `import` any package or URL with
 * no allow list.
 *
 * This is safe precisely because the iframe stays `sandbox="allow-scripts"`
 * with NO `allow-same-origin`: it runs at an opaque origin, so no cookies,
 * storage or credentials of the app's origin ever reach it, and it cannot
 * touch the parent DOM — all it can do is talk over the transferred
 * MessagePort. `frame-ancestors 'self'` because the app itself embeds it, and
 * `X-Frame-Options: SAMEORIGIN` says the same for legacy enforcement. The
 * response is never cached so a frame document change ships immediately.
 *
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { buildChartFrameHtml } from "../features/custom-chart-playground/buildFrameHtml";

export { CHART_FRAME_PATH } from "../features/custom-chart-playground/bridge/bridgeProtocol";
export { buildChartFrameHtml };

export function buildChartFrameHeaders(): Record<string, string> {
  const csp = [
    "default-src 'none'",
    "script-src https: blob: data: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: blob: data: 'unsafe-inline'",
    "img-src https: blob: data:",
    "font-src https: blob: data:",
    "connect-src https: wss: blob: data:",
    "worker-src blob: https:",
    "child-src blob:",
    "media-src https: blob: data:",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/html; charset=utf-8",
  };
}
