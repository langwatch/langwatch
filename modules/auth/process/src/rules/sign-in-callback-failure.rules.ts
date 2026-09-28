/** The one code an unexplained sign-in failure crosses to the error screen as. */
export const GENERIC_SIGN_IN_ERROR_CODE = "sign_in_failed";

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
