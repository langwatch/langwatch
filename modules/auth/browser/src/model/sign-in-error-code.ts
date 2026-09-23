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
    error === "account not linked" ||
    error === "OAuthAccountNotLinked"
  ) {
    return "OAuthAccountNotLinked";
  }
  return error;
};

/** What one refused sign-in says to the person it refused. */
export interface SignInRefusalCopy {
  title: string;
  body: string;
}

/**
 * The sign-ins an organization's move to its own single sign-on refuses, in
 * words about the person's way in rather than the move behind it.
 */
export const CUTOVER_SIGN_IN_ERRORS: Readonly<Record<string, SignInRefusalCopy>> = {
  SSO_LEGACY_AUTH_RETIRED: {
    title: "Your organization moved its sign-in",
    body: "The way you used to sign in has been retired. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_AUTH_NOT_ALLOWED: {
    title: "Use your organization's sign-in",
    body: "This account is not one your organization's single sign-on recognises. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_LINK_NOT_ALLOWED: {
    title: "Use your organization's sign-in",
    body: "This account is not one your organization's single sign-on recognises. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_AUTH_AMBIGUOUS: {
    title: "We could not tell which account this is",
    body: "You hold more than one account with this provider, so we cannot tell which workspace to open. Ask an administrator in your organization for help.",
  },
  SSO_MIGRATION_LINK_AMBIGUOUS: {
    title: "We could not tell which account this is",
    body: "You hold more than one account with this provider, so we cannot tell which workspace to open. Ask an administrator in your organization for help.",
  },
  SSO_MIGRATION_LINK_UNVERIFIED: {
    title: "Your sign-in did not confirm your email",
    body: "Your organization's single sign-on did not confirm your email address, so we could not connect it to your account. Ask an administrator in your organization for help.",
  },
};

/** The words for a refused sign-in, or nothing where the code names none. */
export const cutoverSignInRefusal = (error: string): SignInRefusalCopy | undefined =>
  CUTOVER_SIGN_IN_ERRORS[error];
