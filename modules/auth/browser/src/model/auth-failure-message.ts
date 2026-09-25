/**
 * Customer wording for sign-in/sign-up failures; better-auth codes here, platform from registry
 */
import { explainErrorCode } from "./error-presentation.ts";

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

/**
 * Every identifier meaning "not the credentials for this account".
 * `user_not_found` belongs here: telling a stranger which addresses have
 * accounts is an enumeration oracle, so it must read like a wrong password.
 */
const CREDENTIAL_REJECTION_KEYS = new Set([
  "invalid_email_or_password",
  "credentialssignin",
  "user_not_found",
  "identity_sign_in_refused",
]);

/**
 * Credential rejection (not rate limit or address mismatch); sign-up uses to retry
 */
export const isCredentialRejection = ({
  code,
  message,
}: {
  code?: string;
  message?: string;
}): boolean => CREDENTIAL_REJECTION_KEYS.has(normalize(code) || normalize(message));

/** The wording for each identifier worth naming beyond a credential rejection. */
const KEYED_MESSAGES: Record<string, string> = {
  // Naming the concept ("origin", "trusted origins") would only help someone
  // who already knows the answer. The address bar is the thing this reader can
  // actually look at.
  invalid_origin:
    "LangWatch is set up for a different web address than the one you are using. Check the address and try again.",
  user_already_exists: "An account with that email already exists. Try signing in instead.",
  email_not_verified: "Verify your email address before signing in.",
};

/**
 * Registry copy for platform error code; installed registry via explainErrorCode
 */
const registryMessage = (key: string): string | null => {
  // A probe, not a failure: the envelope fields carry the reader's own
  // defaults for an absent value, which is what `readHandledError` writes when
  // the wire says nothing. Only whether copy exists, and what it says, is read.
  const explanation = explainErrorCode({
    code: key,
    httpStatus: 500,
    meta: {},
    tips: [],
    traceId: undefined,
  });
  if (!explanation) return null;
  const title = explanation.title.endsWith(".") ? explanation.title : `${explanation.title}.`;
  return explanation.description ? `${title} ${explanation.description}` : title;
};

/**
 * Failures named by their status class rather than an identifier: a rate limit
 * and a server-side fault each get their own sentence, everything else falls
 * through to the message-or-fallback handling.
 */
const statusClassMessage = (status: number | undefined, key: string): string | null => {
  if (status === 429 || key.includes("too_many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (status !== undefined && status >= 500) {
    return "Something went wrong on our side. Try again in a moment.";
  }
  return null;
};

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

  if (CREDENTIAL_REJECTION_KEYS.has(key)) {
    return "Invalid email or password.";
  }
  // better-auth's own vocabulary first: those identifiers are its, and the
  // registry has no entry for them. The registry BEFORE the status class,
  // because a platform refusal with named copy must not be flattened into
  // "something went wrong on our side" by its own 5xx.
  const keyed = KEYED_MESSAGES[key] ?? registryMessage(key) ?? statusClassMessage(status, key);
  if (keyed) {
    return keyed;
  }

  // An unmapped message can still be a real sentence worth showing ("Password
  // is too short"). A bare identifier never is.
  if (message && !isInternalCode(message)) {
    return message.endsWith(".") ? message : `${message}.`;
  }

  return fallback;
};
