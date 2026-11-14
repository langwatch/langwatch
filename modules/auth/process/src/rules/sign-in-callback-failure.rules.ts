import { GENERIC_SIGN_IN_ERROR_CODE, signInErrorMayCross } from "@langwatch/auth-contract";
import { parseSignInIdpKind, type RefusedSignInClassification } from "@langwatch/identity-contract";

/** The query parameters that survive a withheld failure: an allowlist, so a new one is withheld. */
const CARRIED_THROUGH = ["callbackUrl"] as const;

/**
 * The paths a browser arrives at from an identity provider: the social callback, the generic
 * OAuth callback, the SSO plugin's OIDC callback and its SAML assertion consumer.
 */
const SIGN_IN_CALLBACK_PATH =
  /^\/api\/auth\/(?:callback\/|oauth2\/callback\/|sso\/callback(?:\/|$)|sso\/saml2\/sp\/acs(?:\/|$))/;

/** Whether a person's browser navigated here, rather than the app or an API client calling it. */
export function isSignInCallbackPath({ pathname }: { pathname: string }): boolean {
  return SIGN_IN_CALLBACK_PATH.test(pathname);
}

/** The page an identity provider sends a refused person to, set per connection by its admin. */
const REFUSAL_PAGE_PATH = /^\/api\/auth\/sso\/refused\/([^/]+)$/;

/**
 * The connection a refusal page visit names, or undefined when this is not one. It carries no
 * round trip, so it never names the person: the card shows the provider kind only.
 * @see specs/identity/idp-refused-sign-in.feature
 */
export function extractRefusalPageConnection({
  pathname,
  method,
}: {
  pathname: string;
  method: string;
}): string | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  const segment = REFUSAL_PAGE_PATH.exec(pathname)?.[1];
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment) || undefined;
  } catch {
    return undefined;
  }
}

/** The error screen with the generic code, and the trace id that ties it to the log line. */
export function signInFailureLocation({
  errorPageUrl,
  traceId,
}: {
  errorPageUrl: string;
  traceId: string | undefined;
}): string {
  const target = new URL(errorPageUrl);
  target.searchParams.set("error", GENERIC_SIGN_IN_ERROR_CODE);
  if (traceId) target.searchParams.set("trace", traceId);
  return target.toString();
}

/** The code an identity provider answers when it refuses the person (OAuth 2.0 `access_denied`). */
const PROVIDER_REFUSAL_CODE = "access_denied";

/** What the boundary does with one redirect Better Auth answered. */
type SignInErrorRedirect =
  | { kind: "pass" }
  /** An admitted code a callback sent somewhere other than the error screen, moved onto it. */
  | { kind: "misdirected"; location: string }
  | { kind: "provider_refused"; code: string; answeredCode: string; location: string }
  | { kind: "withhold"; code: string; description: string; location: string };

/**
 * Only an admitted refusal code crosses to the sign-in error screen. Anything else becomes the
 * generic code with the trace id, keeping `callbackUrl` so the card's recovery still works.
 */
export function signInErrorRedirectOf({
  status,
  location,
  errorPageUrl,
  traceId,
  providerRefused = false,
  isCallback = false,
}: {
  status: number;
  location: string | null;
  errorPageUrl: string;
  traceId: string | undefined;
  /** The provider said no in a shape Better Auth names otherwise: a SAML Response's status. */
  providerRefused?: boolean;
  /** A callback's failure lands on the error screen wherever Better Auth pointed it. */
  isCallback?: boolean;
}): SignInErrorRedirect {
  if (status < 300 || status >= 400 || !location) return { kind: "pass" };
  const [target, onErrorPage] = errorPageTargetOf({ location, errorPageUrl, isCallback });
  if (!target) return { kind: "pass" };
  const code = target.searchParams.get("error");
  if (!code) return { kind: "pass" };
  // Crosses as itself, but is the tenant's own refusal, so the caller logs it at warn. Only the
  // code is kept: the provider's description is caller-controlled text, so it is neither logged
  // nor left in the address bar.
  if (code === PROVIDER_REFUSAL_CODE || providerRefused) {
    const location = rebuiltLocation({
      target,
      errorPageUrl,
      code: PROVIDER_REFUSAL_CODE,
      traceId,
    });
    return { kind: "provider_refused", code: PROVIDER_REFUSAL_CODE, answeredCode: code, location };
  }
  if (signInErrorMayCross(code)) {
    if (onErrorPage) return { kind: "pass" };
    return {
      kind: "misdirected",
      location: rebuiltLocation({ target, errorPageUrl, code, traceId }),
    };
  }

  return {
    kind: "withhold",
    code,
    description: target.searchParams.get("error_description") ?? "",
    location: rebuiltLocation({ target, errorPageUrl, code: GENERIC_SIGN_IN_ERROR_CODE, traceId }),
  };
}

/** The error screen with `code`, the trace id and only the allowlisted parameters of `target`. */
function rebuiltLocation({
  target,
  errorPageUrl,
  code,
  traceId,
}: {
  target: URL;
  errorPageUrl: string;
  code: string;
  traceId: string | undefined;
}): string {
  const rebuilt = new URL(errorPageUrl);
  for (const carried of CARRIED_THROUGH) {
    const value = target.searchParams.get(carried);
    if (value !== null) rebuilt.searchParams.set(carried, value);
  }
  rebuilt.searchParams.set("error", code);
  if (traceId) rebuilt.searchParams.set("trace", traceId);
  return rebuilt.toString();
}

/**
 * The redirect's target and whether it is the error screen. On a callback, an `error` sent to the
 * app's root counts too: Better Auth falls back there when it cannot read the RelayState. Other
 * pages are left alone, since the SSO test returns its errors to its own settings page.
 */
function errorPageTargetOf({
  location,
  errorPageUrl,
  isCallback,
}: {
  location: string;
  errorPageUrl: string;
  isCallback: boolean;
}): [] | [URL, boolean] {
  try {
    const errorPage = new URL(errorPageUrl);
    const target = new URL(location, errorPage);
    const sameOrigin = target.origin === errorPage.origin;
    const isErrorPage = sameOrigin && target.pathname === errorPage.pathname;
    if (isErrorPage) return [target, true];
    const isRoot = sameOrigin && target.pathname === "/";
    return isCallback && isRoot && target.searchParams.has("error") ? [target, false] : [];
  } catch {
    // A Location we cannot parse is one we cannot rewrite; it passes as it came.
    return [];
  }
}

/** The code a refusal crosses as when the organization is out of seats for the person. */
const SEAT_LIMIT_CODE = "seat_limit_reached";

/**
 * A provider refusal's redirect, once classified: the seat-limit code when the organization would
 * hold the person for a seat, else `access_denied` with the provider kind when it is admitted.
 * The reference replaces any trace id, so the card and the log line carry the same one.
 * @see specs/identity/idp-refused-sign-in.feature
 */
export function refusedSignInLocationOf({
  location,
  verdict,
  reference,
}: {
  location: string;
  verdict: Pick<RefusedSignInClassification, "outcome" | "idp"> | undefined;
  reference: string;
}): string {
  const target = new URL(location);
  target.searchParams.delete("idp");
  target.searchParams.set("trace", reference);
  if (verdict?.outcome === "seat_limit") {
    target.searchParams.set("error", SEAT_LIMIT_CODE);
    return target.toString();
  }
  target.searchParams.set("error", PROVIDER_REFUSAL_CODE);
  const idp = parseSignInIdpKind(verdict?.idp);
  if (idp) target.searchParams.set("idp", idp);
  return target.toString();
}
