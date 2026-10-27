/**
 * Same-origin gate for /api/auth/*. GET/OPTIONS/HEAD allowed; state-changing
 * methods require Origin or Referer matching baseUrl, except the exact SAML ACS
 * POST an identity provider submits cross-site (Better Auth validates it).
 */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const SAML_ASSERTION_CONSUMER = /^\/api\/auth\/sso\/saml2\/sp\/acs\/[^/?#]+$/;

/** The scheme, host and port of a URL-ish header value; null where it names none. */
export function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedAuthOrigin(opts: {
  method: string | undefined;
  pathname?: string;
  origin: string | undefined;
  referer: string | undefined;
  baseUrl: string;
}): boolean {
  const { method, pathname = "", origin, referer, baseUrl } = opts;
  if (method === "POST" && SAML_ASSERTION_CONSUMER.test(pathname)) return true;
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
