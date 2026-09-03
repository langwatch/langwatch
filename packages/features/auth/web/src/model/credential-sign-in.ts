import { authFailureMessage } from "./auth-failure-message";

/** What the auth client answers a credential sign-in with. */
export interface CredentialSignInResponse {
  error?: string;
  code?: string;
  status?: number;
  /** The rate limiter's remaining window, when it sent one. */
  retryAfterSeconds?: number;
}

export interface CredentialSignInFailure {
  message: string;
  /**
   * How long until trying again is worth anything, or null when the refusal
   * was not a rate limit or did not say. Null means the screen says the
   * general sentence and leaves the button alone: a submit disabled for a
   * duration nobody knows is a worse guess than no guess.
   */
  retryAfterSeconds: number | null;
}

/**
 * The wording for a credential sign-in that did not go through, or null when
 * it did.
 *
 * One reader for both screens, over the same mapper the legacy screens use:
 * the failure anchors (`sign-in-failure-messages.feature`) say a wrong
 * password, a rate limit and an installation set up for another address each
 * get their own sentence, and none of them ever puts an identifier on screen.
 */
export function credentialSignInFailure({
  response,
  fallback,
}: {
  response: CredentialSignInResponse | null | undefined;
  fallback?: string;
}): CredentialSignInFailure | null {
  const failed =
    Boolean(response?.error) || (response?.status !== undefined && response.status >= 400);
  if (!failed) return null;

  const wait = response?.retryAfterSeconds;
  return {
    message: authFailureMessage({
      code: response?.code,
      message: response?.error,
      status: response?.status,
      fallback,
    }),
    retryAfterSeconds:
      response?.status === 429 && typeof wait === "number" && wait > 0 ? Math.ceil(wait) : null,
  };
}

/**
 * The wait, as a person counts it. Minutes once there is more than one, and
 * seconds below that, because "in 1 minute" for a 20 second wait is the kind
 * of small lie that gets somebody to walk away from their desk.
 */
export function describeRemainingWait(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  return `Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}
