/**
 * Which sign-in failures are allowed to reach the address bar, and what the
 * rest become.
 *
 * A SIGN-IN THAT FAILS DOES NOT RETURN A RESPONSE, IT REDIRECTS. Whatever the
 * failure carried travels in the query string of a page somebody is looking
 * at, in a URL they can copy, paste into a ticket, and keep in their history.
 * `@better-auth/sso` throws `APIError`s carrying its own codes and its own
 * internal prose, and every one of them reached the browser verbatim — a real
 * sign-in failed with `SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS` and
 * a description naming a capability of our storage layer.
 *
 * So this module is the list, and the list is the boundary: a refusal we have
 * written down travels as its own code, and everything else becomes one
 * generic code with the real cause logged instead. It is ADR-045's rule
 * applied to a redirect rather than to a response body.
 *
 * FRAMEWORK-FREE ON PURPOSE. The screen decides what to SAY about a code and
 * the server decides whether the code may travel, and those two must not be
 * able to disagree — a code that crosses with no copy written for it renders
 * as the generic arm anyway, and copy for a code that can no longer cross is
 * dead. One list, imported by both, and nothing here imports React so the
 * server may have it (`sso-connection-history-copy.ts` reaches into
 * `@ee/sso/logic` the same way).
 *
 * Spec: specs/identity/sso-signin-error-boundary.feature
 */

/**
 * BetterAuth emits granular low-level error codes (e.g. `email_doesn't_match`,
 * `LINKING_DIFFERENT_EMAILS_NOT_ALLOWED`) from the link-account flow. Map
 * them back to the friendly uppercase codes this UI already handles, so
 * the same error page works for both the NextAuth-era codes we throw from
 * hooks and the BetterAuth-native ones coming out of the OAuth callback.
 */
export const normalizeErrorCode = (
  error: string | null | undefined,
): string | null => {
  if (!error) return null;
  if (
    error === "email_doesn't_match" ||
    error === "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED"
  ) {
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

/**
 * Auth errors that represent a *stable* failure the user has to act on (wrong
 * sign-in method / account collision), not a transient glitch we can silently
 * retry. For these we must NOT auto-redirect back to the identity provider:
 * the IdP still holds a live session for the failing identity, so bouncing
 * straight back silently re-authenticates the same identity and traps the user
 * in a loop (the exact symptom behind the "stuck in the sign-in loop" report).
 * Recovery instead goes through a federated logout so the IdP session is
 * cleared first and the next attempt lets them pick a different method.
 *
 * Shared between the error page and the sign-in page so the two auto-redirect
 * gates can never drift apart — and, since these are exactly the codes a
 * screen has written words for, it is also the list that may cross the
 * boundary above.
 */
export const STABLE_AUTH_ERRORS = [
  "OAuthAccountNotLinked",
  "DIFFERENT_EMAIL_NOT_ALLOWED",
  "SSO_PROVIDER_NOT_ALLOWED",
  // Stable in the same sense as the three above: retrying the same way will
  // fail the same way, because what has to change is a person's decision,
  // not the attempt.
  "LINK_NEEDS_APPROVAL",
  // Stable only as a FALLBACK. The ordinary path for this code is the bounce,
  // which leaves before any timer runs; it reaches the card when the refusal
  // named no connection the page is willing to dial, and then the same button
  // would be refused the same way.
  "SSO_REQUIRED_BY_ORGANIZATION",
  // Every refusal the assertion gate makes
  // (specs/identity/sso-assertion-refusals.feature). All five are stable in
  // the strongest sense: the identity provider still holds a live session, so
  // bouncing back re-authenticates the SAME identity and is refused the same
  // way — a loop, not a retry. What has to change is a domain proof, a claim
  // release or a connection going live, and none of those happens between two
  // redirects.
  "sso_sign_in_refused",
  "sso_assertion_without_address",
  "sso_setup_address_mismatch",
  "sso_domain_not_verified",
  "sso_domain_proof_lapsed",
] as const;

export const isStableAuthError = (error: string | null | undefined): boolean =>
  !!error && (STABLE_AUTH_ERRORS as readonly string[]).includes(error);

/**
 * The one code every failure we have not written down arrives as.
 *
 * Lower case and ours, rather than better-auth's shouting: it is a code the
 * screen matches on, and its words come from the screen's default arm —
 * "Something went wrong signing you in" — which is the same thing an
 * unrecognised code has always rendered. So nothing about the screen changes;
 * what changes is that the address no longer carries the internal reason.
 */
export const GENERIC_SIGN_IN_ERROR_CODE = "sign_in_failed";

/**
 * Whether this code is one of ours to hand to somebody, or one to withhold.
 *
 * Derived from the stable list through the same normalisation the screen
 * applies, rather than written out a second time: an alias that resolves to a
 * code with copy is a code with copy, and adding a refusal to
 * `STABLE_AUTH_ERRORS` is all it takes for that refusal to start crossing.
 * There is no second list to forget.
 */
export function signInErrorMayCross(code: string | null | undefined): boolean {
  return isStableAuthError(normalizeErrorCode(code));
}
