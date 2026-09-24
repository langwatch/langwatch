/**
 * Same-origin gate for /api/auth/*. GET/OPTIONS/HEAD allowed; state-changing
 * methods require Origin or Referer matching baseUrl.
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function parseOrigin(value: string | undefined): string | null {
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

  const expected = parseOrigin(baseUrl);
  if (!expected) return false;

  const headerOrigin = parseOrigin(origin);
  if (headerOrigin !== null) {
    return headerOrigin === expected;
  }
  // No Origin header — fall back to Referer (some browsers omit Origin
  // on same-origin POSTs depending on the Referrer-Policy).
  const headerReferer = parseOrigin(referer);
  return headerReferer === expected;
}
