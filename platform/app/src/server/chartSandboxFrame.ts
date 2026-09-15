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
 * This is safe precisely because the document ALWAYS runs at an opaque origin,
 * so no cookies, storage or credentials of the app's origin ever reach it, and
 * it cannot touch the parent DOM — all it can do is talk over the transferred
 * MessagePort. Two things force that opaque origin, and the CSP one is what
 * makes the route safe to navigate directly:
 *  - the embedding iframe carries `sandbox="allow-scripts"` (no
 *    `allow-same-origin`), and
 *  - the response CSP carries `sandbox allow-scripts`, which sandboxes the
 *    document itself regardless of how it is loaded. So even if an attacker
 *    opens the route at top level (`window.open`), where there is no iframe
 *    `sandbox` attribute, the document is still an opaque-origin sandbox with
 *    no cookies — the shim's `lw:init` can then never reach the app origin.
 * The two `allow-scripts`-only sandboxes intersect, so the legitimate embed is
 * unchanged. `frame-ancestors 'self'` because the app itself embeds it, and
 * `X-Frame-Options: SAMEORIGIN` says the same for legacy enforcement. The
 * response is never cached so a frame document change ships immediately.
 *
 * This policy REPLACES the app-wide one for that response in both modes:
 * `start.ts` removes the app's `Content-Security-Policy` and its dev-only
 * `Content-Security-Policy-Report-Only` before setting these headers, so the
 * app policy never lingers on the frame response.
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
    // Forces opaque-origin sandboxing of THIS document however it is loaded,
    // so the route is safe to navigate directly (not only when embedded in the
    // parent's allow-scripts iframe). allow-scripts only, matching the iframe
    // attribute — the two sandboxes intersect, so the legitimate embed runs
    // unchanged.
    "sandbox allow-scripts",
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
