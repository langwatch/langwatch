import { authFailureMessage } from "./auth-failure-message.ts";

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
   * wasn't a rate limit or didn't say. Null means the screen uses the
   * general sentence: a submit disabled for an unknown duration is worse than no guess.
   */
  retryAfterSeconds: number | null;
}

/**
 * Wording for credential sign-in failure; same reader, never puts identifier on screen
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
