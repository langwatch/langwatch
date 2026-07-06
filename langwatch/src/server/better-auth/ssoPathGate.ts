/**
 * Pure path predicates for the ADR-027 license-gated SSO decision, extracted
 * from `src/server/better-auth/index.ts` for cohesion and unit testing
 * (same pattern as `originGate.ts`). These answer only *which BetterAuth
 * endpoint is this?* — the license half of the decision lives in
 * `src/server/sso/sso-gate.ts` (`platformSSOAllowed`), and the before-hook
 * composes the two.
 *
 * All matching is done on the NORMALIZED pathname (query stripped, trailing
 * slashes removed): the router (rou3) resolves `/sign-up/email/` to the same
 * handler as `/sign-up/email`, so suffix-matching the raw URL would let a
 * one-character variant walk past every block.
 */

/**
 * ADR-027 gate site #2 — the SSO-initiation paths blocked when the platform
 * gate denies. Verified against better-auth 1.6.x + genericOAuth (v5 MAJOR
 * fix): `/oauth2/authorize` is a phantom (that's the OIDC-*provider* endpoint,
 * not a client one) and is deliberately excluded. `/link-social` +
 * `/oauth2/link` are included so a coerced-mode user can't pre-link a provider
 * that goes live after a later allow-flip.
 */
export const GATED_SSO_INITIATION_SUFFIXES = [
  "/sign-in/social",
  "/sign-in/oauth2",
  "/link-social",
  "/oauth2/link",
] as const;

/**
 * Credential-mutation endpoints blocked in EVERY gate state on an SSO-capable
 * deployment (ADR-027 Constants table) — no logged-in session can attach or
 * change a password. The password-reset pair is deliberately excluded: it is
 * gate-dependent (blocked on ALLOW, open on DENY) and handled separately.
 */
const CREDENTIAL_MUTATION_SUFFIXES = [
  "/change-password",
  "/set-password",
  "/change-email",
  "/send-verification-email",
  "/verify-email",
] as const;

/** Endpoints that mint or authenticate a password account (blocked on ALLOW). */
const EMAIL_AUTH_SUFFIXES = ["/sign-in/email", "/sign-up/email"] as const;

/** The password-reset pair: blocked on gate-ALLOW, open on gate-DENY (v6). */
const PASSWORD_RESET_SUFFIXES = [
  "/request-password-reset",
  "/reset-password",
] as const;

/**
 * Extracts the pathname from a BetterAuth request URL, stripping the query
 * string. Falls back to a naive split if the URL isn't absolute (shouldn't
 * happen in production, but keeps this defensive for tests).
 */
export const requestPathname = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
};

/**
 * Pathname with trailing slashes stripped, for endpoint suffix matching —
 * see the module docblock for why the raw URL is never a safe target.
 */
export const normalizedRequestPathname = (url: string): string =>
  requestPathname(url).replace(/\/+$/, "");

const endsWithAny = (pathname: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => pathname.endsWith(suffix));

export const isCredentialMutationPath = (pathname: string): boolean =>
  endsWithAny(pathname, CREDENTIAL_MUTATION_SUFFIXES);

export const isEmailAuthPath = (pathname: string): boolean =>
  endsWithAny(pathname, EMAIL_AUTH_SUFFIXES);

export const isPasswordResetPath = (pathname: string): boolean =>
  endsWithAny(pathname, PASSWORD_RESET_SUFFIXES);

/**
 * ADR-027 gate site #2 — true for any request refused while the platform SSO
 * gate denies: the initiation paths, plus ANY callback path (pathname-PREFIX
 * match via `includes`, since callbacks carry `?code=&state=` and a provider
 * segment, e.g. `/callback/auth0`, `/oauth2/callback/okta`). This is the only
 * interception point that sees the legacy `/api/auth/callback/auth0|okta`
 * rewrite (`redirectURI` pinned in index.ts), so a path-prefix middleware on
 * `/oauth2/*` alone would miss it entirely.
 */
export const isGatedSsoPath = (url: string): boolean => {
  const pathname = normalizedRequestPathname(url);
  if (endsWithAny(pathname, GATED_SSO_INITIATION_SUFFIXES)) {
    return true;
  }
  return requestPathname(url).includes("/callback/");
};
