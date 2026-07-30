/**
 * Customer-facing wording for a failed sign-in or sign-up.
 *
 * The auth layer answers with a code (`INVALID_EMAIL_OR_PASSWORD`,
 * `INVALID_ORIGIN`, ...) and a terse message written for whoever wired the
 * installation up, not for the person staring at the form. This maps the
 * failures worth naming onto wording that person can act on, and refuses to
 * put a raw code on screen.
 *
 * Shared by the sign-in and sign-up screens so the two cannot drift.
 */

const GENERIC = "Sign in did not go through. Please try again.";

/**
 * `INVALID_ORIGIN`, `CredentialsSignin`, `account_not_linked`: one token, no
 * spaces. Everything the auth layer means for a human to read is a phrase.
 */
const isInternalCode = (value: string): boolean => !/\s/.test(value.trim());

const normalize = (value: string | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const authFailureMessage = ({
  code,
  message,
  status,
  fallback = GENERIC,
}: {
  code?: string;
  message?: string;
  status?: number;
  /** Wording for a failure with no recognisable code, e.g. on the sign-up screen. */
  fallback?: string;
}): string => {
  const key = normalize(code) || normalize(message);

  switch (key) {
    // `user_not_found` gets the same wording on purpose: telling a stranger
    // which addresses have accounts is an enumeration oracle.
    case "invalid_email_or_password":
    case "credentialssignin":
    case "user_not_found":
      return "Invalid email or password.";
    case "invalid_origin":
      // Naming the concept ("origin", "trusted origins") would only help
      // someone who already knows the answer. The address bar is the thing
      // this reader can actually look at.
      return "LangWatch is set up for a different web address than the one you are using. Check the address and try again.";
    case "user_already_exists":
      return "An account with that email already exists. Try signing in instead.";
    case "email_not_verified":
      return "Verify your email address before signing in.";
  }

  if (status === 429 || key.includes("too_many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (status !== undefined && status >= 500) {
    return "Something went wrong on our side. Try again in a moment.";
  }

  // An unmapped message can still be a real sentence worth showing ("Password
  // is too short"). A bare identifier never is.
  if (message && !isInternalCode(message)) {
    return message.endsWith(".") ? message : `${message}.`;
  }

  return fallback;
};
