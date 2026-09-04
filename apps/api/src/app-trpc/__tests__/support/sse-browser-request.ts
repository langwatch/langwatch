/**
 * How a browser opens the subscription lane, for every suite that drives it.
 *
 * The lane refuses a request that carries no positive same-site signal
 * (`apps/api/src/api-rest.cross-site.ts`), so a bare `hono.request("/api/sse/…")`
 * is a cross-site request as far as the gate is concerned — which is correct,
 * and would otherwise leave every SSE suite pinning a 403 by accident.
 *
 * `Sec-Fetch-Site` rather than `Origin` because that is what a same-origin
 * `EventSource` actually sends: a browser omits `Origin` on a same-origin GET,
 * and the gate reads `Origin` only as the fallback for browsers too old to send
 * the fetch-metadata header. Both paths are pinned in the lane's own suite.
 */
export const SAME_ORIGIN_SSE_HEADERS: Readonly<Record<string, string>> = {
  "sec-fetch-site": "same-origin",
};

/** A `hono.request` init that arrives the way a browser's `EventSource` does. */
export function sameOriginSseInit(
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): RequestInit {
  return { ...init, headers: { ...SAME_ORIGIN_SSE_HEADERS, ...init.headers } };
}
