/**
 * BetterAuth's granular link-account codes, folded to one spelling per
 * failure — so the error screen and a peer reading the same `?error=` can
 * never disagree about which failure it is.
 */
export const normalizeSignInErrorCode = (error: string | null | undefined): string | null => {
  if (!error) return null;
  if (error === "email_doesn't_match" || error === "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED") {
    return "DIFFERENT_EMAIL_NOT_ALLOWED";
  }
  if (
    error === "account_already_linked_to_different_user" ||
    error === "account_not_linked" ||
    error === "OAuthAccountNotLinked"
  ) {
    return "OAuthAccountNotLinked";
  }
  return error;
};
