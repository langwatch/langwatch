/**
 * Which sign-in failures may reach the address bar, and what the rest become. The server decides
 * whether a code travels and the screen decides what to say about it; one list serves both, so
 * the two cannot disagree. Pure and framework-free, like `sso-path-gate.ts`.
 * @see specs/identity/sso-signin-error-boundary.feature
 */

/** Better Auth's granular link-account codes, folded to one spelling per failure. */
export const normalizeSignInErrorCode = (error: string | null | undefined): string | null => {
  if (!error) return null;
  if (error === "email_doesn't_match" || error === "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED") {
    return "DIFFERENT_EMAIL_NOT_ALLOWED";
  }
  if (
    error === "account_already_linked_to_different_user" ||
    error === "account_not_linked" ||
    error === "account not linked" ||
    error === "OAuthAccountNotLinked"
  ) {
    return "OAuthAccountNotLinked";
  }
  return error;
};

/** The sign-ins an organization's move to its own single sign-on refuses. */
export const CUTOVER_SIGN_IN_ERROR_CODES = [
  "SSO_LEGACY_AUTH_RETIRED",
  "SSO_MIGRATION_AUTH_NOT_ALLOWED",
  "SSO_MIGRATION_LINK_NOT_ALLOWED",
  "SSO_MIGRATION_AUTH_AMBIGUOUS",
  "SSO_MIGRATION_LINK_AMBIGUOUS",
  "SSO_MIGRATION_LINK_UNVERIFIED",
] as const;

export type CutoverSignInErrorCode = (typeof CUTOVER_SIGN_IN_ERROR_CODES)[number];

/**
 * Stable failures somebody has to act on, never retried by bouncing back to the identity
 * provider, and exactly the codes a screen has words for. So it is also the list that may cross.
 */
export const STABLE_AUTH_ERRORS = [
  "OAuthAccountNotLinked",
  "DIFFERENT_EMAIL_NOT_ALLOWED",
  "SSO_PROVIDER_NOT_ALLOWED",
  // Stable only as a fallback: the bounce leaves before any timer, and reaches the card only
  // when the refusal named no connection the page will dial.
  "SSO_REQUIRED_BY_ORGANIZATION",
  ...CUTOVER_SIGN_IN_ERROR_CODES,
  // The assertion gate's refusals: the provider still holds a live session, so a retry loops.
  "sso_sign_in_refused",
  "sso_assertion_without_address",
  "sso_setup_address_mismatch",
  "sso_domain_not_verified",
  "sso_domain_proof_lapsed",
  // An unconfirmed account holds the address and this sign-in cannot vouch for it: a domain
  // proof or the provider's claim has to change (sso-link-unconfirmed-local-account.feature).
  "sso_existing_account_unconfirmed",
] as const;

export const isStableAuthError = (error: string | null | undefined): boolean =>
  !!error && (STABLE_AUTH_ERRORS as readonly string[]).includes(error);

/** The one code every failure we have not written down arrives as. */
export const GENERIC_SIGN_IN_ERROR_CODE = "sign_in_failed";

/** Whether this code is one of ours to hand to somebody, or one to withhold. */
export function signInErrorMayCross(code: string | null | undefined): boolean {
  return isStableAuthError(normalizeSignInErrorCode(code));
}
