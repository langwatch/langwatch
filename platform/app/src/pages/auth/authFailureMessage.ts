/**
 * Customer-facing wording for a failed sign-in or sign-up.
 *
 * The auth layer answers with a code (`INVALID_EMAIL_OR_PASSWORD`,
 * `INVALID_ORIGIN`, ...) and a terse message written for whoever wired the
 * installation up, not for the person staring at the form. This maps the
 * failures worth naming onto wording that person can act on, and refuses to
 * put a raw code on screen.
 *
 * TWO sources of copy, because two different things answer this endpoint.
 * better-auth's own identifiers are its own vocabulary and have no
 * handled-error registry entry, so their wording lives here. Everything the
 * platform refuses with — the identity storage adapter translates a
 * `HandledError` into an `APIError` carrying its stable `code` (ADR-116 §6) —
 * reads from the client presentation registry, which is where every other
 * surface gets the words for a code. Writing a second set here would mean the
 * same failure reads differently depending on which screen a customer is on.
 *
 * Shared by the sign-in and sign-up screens so the two cannot drift.
 */
import { explainHandledError } from "~/features/errors/logic/presentation";

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
 * Every identifier the auth layer uses for "those are not the credentials for
 * this account". `user_not_found` belongs in here on purpose: telling a
 * stranger which addresses have accounts is an enumeration oracle, so it must
 * be indistinguishable from a wrong password everywhere this set is read.
 */
const CREDENTIAL_REJECTION_KEYS = new Set([
  "invalid_email_or_password",
  "credentialssignin",
  "user_not_found",
]);

/**
 * The auth layer's way of saying "those are not the credentials for this
 * account", as opposed to a rate limit, an address mismatch, or our side
 * falling over, each of which needs its own wording.
 *
 * The sign-up screen branches on this: it retries the sign-in with whatever the
 * customer typed, and a credential rejection is the one outcome that means the
 * address belongs to an account they cannot open. Reads the same set the
 * wording below does, so the two answers cannot drift.
 */
export const isCredentialRejection = ({
  code,
  message,
}: {
  code?: string;
  message?: string;
}): boolean =>
  CREDENTIAL_REJECTION_KEYS.has(normalize(code) || normalize(message));

/** The wording for each identifier worth naming beyond a credential rejection. */
const KEYED_MESSAGES: Record<string, string> = {
  // Naming the concept ("origin", "trusted origins") would only help someone
  // who already knows the answer. The address bar is the thing this reader can
  // actually look at.
  invalid_origin:
    "LangWatch is set up for a different web address than the one you are using. Check the address and try again.",
  user_already_exists:
    "An account with that email already exists. Try signing in instead.",
  email_not_verified: "Verify your email address before signing in.",
};

/**
 * The registry's copy for a platform error code, as one sentence.
 *
 * `isRegistered` is the whole test: an entry exists for this code, so the
 * words were written for this failure. Anything else — better-auth's own
 * identifiers, a code nobody has given copy yet — answers null and falls
 * through to the handling below, which is the ADR-045 degradation path.
 */
const registryMessage = (key: string): string | null => {
  const explanation = explainHandledError({
    code: key,
    meta: {},
    httpStatus: 500,
    fault: "platform",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  if (!explanation.isRegistered) return null;
  const title = explanation.title.endsWith(".")
    ? explanation.title
    : `${explanation.title}.`;
  return explanation.description
    ? `${title} ${explanation.description}`
    : title;
};

/**
 * Failures named by their status class rather than an identifier: a rate limit
 * and a server-side fault each get their own sentence, everything else falls
 * through to the message-or-fallback handling.
 */
const statusClassMessage = (
  status: number | undefined,
  key: string,
): string | null => {
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
  const keyed =
    KEYED_MESSAGES[key] ??
    registryMessage(key) ??
    statusClassMessage(status, key);
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
