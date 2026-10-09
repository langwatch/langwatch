/**
 * Pure same-origin gate for `/api/auth/*` requests, extracted from
 * `src/pages/api/auth/[...all].ts` for unit testing.
 *
 * Returns `true` if the request should be allowed through to
 * BetterAuth, `false` if it should be rejected with 403 INVALID_ORIGIN.
 *
 * Rules:
 * - GET/OPTIONS/HEAD always allowed (read-only / preflight).
 * - The exact SAML ACS POST path accepts a cross-origin IdP form submission;
 *   BetterAuth performs the assertion, provider and replay validation.
 * - State-changing methods (POST/PUT/DELETE/PATCH) require either
 *   `Origin` matching `baseUrl` OR (no `Origin`) `Referer` matching
 *   `baseUrl`. A real browser always sends one of them on POST.
 * - Malformed `baseUrl` → reject everything (fail-closed).
 *
 * `assertAllowedAuthOrigin` applies the same rule to the tRPC sign-up
 * procedures, which write before any `/api/auth/*` call is made.
 */
import { createLogger } from "@langwatch/observability";
import { InvalidAuthOriginError } from "~/server/auth/errors";

const logger = createLogger("langwatch:auth:origin-gate");

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
  pathname?: string;
  origin: string | undefined;
  referer: string | undefined;
  baseUrl: string;
}): boolean {
  const { method, pathname = "", origin, referer, baseUrl } = opts;
  if (
    method === "POST" &&
    /^\/api\/auth\/sso\/saml2\/sp\/acs\/[^/?#]+$/.test(pathname)
  ) {
    return true;
  }
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

/** The first value of a Node-style header, which may arrive repeated. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The origin gate for a state-changing tRPC procedure that acts before any
 * `/api/auth/*` call does, such as creating the account a sign-up then signs
 * in to. Without it the account is written first and the gate refuses only the
 * sign-in after it, which leaves a half-made account behind.
 *
 * Same rule as `isAllowedAuthOrigin` for a POST: `Origin` must match
 * `baseUrl`, or with no `Origin` the `Referer` must. A caller carrying
 * neither, or no request at all, is refused.
 */
export function assertAllowedAuthOrigin({
  req,
  baseUrl,
}: {
  req: { headers?: Record<string, string | string[] | undefined> } | undefined;
  baseUrl: string;
}): void {
  const origin = firstHeader(req?.headers?.origin);
  const referer = firstHeader(req?.headers?.referer);
  if (isAllowedAuthOrigin({ method: "POST", origin, referer, baseUrl })) {
    return;
  }
  logger.warn(
    {
      expectedOrigin: originOf(baseUrl),
      receivedOrigin: originOf(origin),
      receivedReferer: originOf(referer),
    },
    "rejected sign-up request: origin does not match NEXTAUTH_URL",
  );
  throw new InvalidAuthOriginError();
}
