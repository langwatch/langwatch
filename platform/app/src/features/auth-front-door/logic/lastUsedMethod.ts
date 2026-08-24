import type { SignInMethod } from "@langwatch/identity";

/**
 * The method this browser last got in with, so somebody who signs in on the
 * same laptop every day is shown which button that was.
 *
 * Three deliberate limits:
 *
 *   - it is a BADGE, never an order. Moving the buttons around under somebody
 *     who has learned where they are is worse than not helping at all, and a
 *     picker whose order depended on device memory would no longer render
 *     identically for every visitor.
 *   - it lives in this browser and goes nowhere else. It is a convenience, not
 *     a record: a private window, a cleared site data, another device, and
 *     there is simply no badge.
 *   - it says nothing about accounts. The value is a METHOD ("password",
 *     "google"), which is instance-level vocabulary — it cannot tell the next
 *     person at this browser whether an address has an account.
 *
 * Every read and write is wrapped: storage throws outright in some contexts
 * (private modes, blocked site data, preview renderers), and a sign-in screen
 * that cannot render because a badge could not be looked up is a far worse
 * failure than a missing badge.
 */
const STORAGE_KEY = "langwatch.auth.last-used-method";

export function readLastUsedMethodId(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Remembers a method at the last point this screen can see it being used: a
 * password sign-in that came back without a failure, or a federated method at
 * the moment the browser is handed to the provider.
 */
export function rememberLastUsedMethod(method: Pick<SignInMethod, "id">): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, method.id);
  } catch {
    // A browser that will not store it simply does not get the badge.
  }
}

/** Test seam, and the one place the key is written down. */
export const LAST_USED_METHOD_STORAGE_KEY = STORAGE_KEY;
