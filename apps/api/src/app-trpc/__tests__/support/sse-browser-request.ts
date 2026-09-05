/**
 * How a browser opens the subscription lane, for every suite that drives it.
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
