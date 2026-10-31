import { GENERIC_SIGN_IN_ERROR_CODE, signInErrorMayCross } from "@langwatch/auth-contract";

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
  | { kind: "provider_refused"; code: string; location: string }
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
}: {
  status: number;
  location: string | null;
  errorPageUrl: string;
  traceId: string | undefined;
}): SignInErrorRedirect {
  if (status < 300 || status >= 400 || !location) return { kind: "pass" };
  const [target] = errorPageTargetOf({ location, errorPageUrl });
  if (!target) return { kind: "pass" };
  const code = target.searchParams.get("error");
  if (!code) return { kind: "pass" };
  // Crosses as itself, but is the tenant's own refusal, so the caller logs it at warn. Only the
  // code is kept: the provider's description is caller-controlled text, so it is neither logged
  // nor left in the address bar.
  if (code === PROVIDER_REFUSAL_CODE) {
    const location = rebuiltLocation({ target, errorPageUrl, code, traceId });
    return { kind: "provider_refused", code, location };
  }
  if (signInErrorMayCross(code)) return { kind: "pass" };

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

/** A provider's refusal code as an error a log record carries as its cause. */
export type SignInRefusal = Error & { readonly code: string };

/**
 * The cause of a withheld sign-in failure: the provider's own code, so a record reads
 * "state_not_found" and not "a reason we have not written down". The code is never a secret.
 */
export function signInRefusalCause({ code }: { code: string }): SignInRefusal {
  const cause = Object.assign(new Error(`sign-in refused with "${code}"`), { code });
  cause.name = "SignInRefusal";

  return cause;
}

/** The redirect target when it is the sign-in error page itself; a relative Location resolves. */
function errorPageTargetOf({
  location,
  errorPageUrl,
}: {
  location: string;
  errorPageUrl: string;
}): URL[] {
  try {
    const errorPage = new URL(errorPageUrl);
    const target = new URL(location, errorPage);
    const isErrorPage =
      target.origin === errorPage.origin && target.pathname === errorPage.pathname;
    return isErrorPage ? [target] : [];
  } catch {
    // A Location we cannot parse is one we cannot rewrite; it passes as it came.
    return [];
  }
}
