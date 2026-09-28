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

/** What the boundary does with one redirect Better Auth answered. */
export type SignInErrorRedirect =
  | { kind: "pass" }
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
  if (!code || signInErrorMayCross(code)) return { kind: "pass" };

  const withheld = new URL(errorPageUrl);
  for (const carried of CARRIED_THROUGH) {
    const value = target.searchParams.get(carried);
    if (value !== null) withheld.searchParams.set(carried, value);
  }
  withheld.searchParams.set("error", GENERIC_SIGN_IN_ERROR_CODE);
  if (traceId) withheld.searchParams.set("trace", traceId);
  return {
    kind: "withhold",
    code,
    description: target.searchParams.get("error_description") ?? "",
    location: withheld.toString(),
  };
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
