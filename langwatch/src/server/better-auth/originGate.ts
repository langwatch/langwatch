/**
 * Pure same-origin gate for `/api/auth/*` requests, extracted from
 * `src/pages/api/auth/[...all].ts` for unit testing.
 *
 * Returns `true` if the request should be allowed through to
 * BetterAuth, `false` if it should be rejected with 403 INVALID_ORIGIN.
 *
 * Rules:
 * - GET/OPTIONS/HEAD always allowed (read-only / preflight).
 * - State-changing methods (POST/PUT/DELETE/PATCH) require either
 *   `Origin` matching `baseUrl` OR (no `Origin`) `Referer` matching
 *   `baseUrl`. A real browser always sends one of them on POST.
 * - Malformed `baseUrl` → reject everything (fail-closed).
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedAuthOrigin(opts: {
  method: string | undefined;
  origin: string | undefined;
  referer: string | undefined;
  baseUrl: string;
}): boolean {
  const { method, origin, referer, baseUrl } = opts;
  if (!method || !STATE_CHANGING_METHODS.has(method)) return true;

  const expected = originOf(baseUrl);
  if (!expected) return false;

  const headerOrigin = originOf(origin);
  if (headerOrigin !== null) {
    return headerOrigin === expected;
  }
  // No Origin header — fall back to Referer (some browsers omit Origin
  // on same-origin POSTs depending on the Referrer-Policy).
  const headerReferer = originOf(referer);
  return headerReferer === expected;
}
