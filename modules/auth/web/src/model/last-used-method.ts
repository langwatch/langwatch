import type { SignInMethod } from "@langwatch/identity-contract";

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
/**
 * Versioned, and the version is load-bearing.
 *
 * The first key was written the moment a federated button was CLICKED, so
 * every browser that ever tried a provider and backed out is still holding a
 * badge that was never true. Fixing the write does nothing for those: the
 * wrong value is already stored. A new key abandons them, and the old one is
 * cleared on the way past so it does not sit there forever.
 */
const STORAGE_KEY = "langwatch.auth.last-used-method.v2";
const LEGACY_STORAGE_KEY = "langwatch.auth.last-used-method";

/**
 * A federated method that has been dialled but has not got anybody in yet.
 *
 * The browser leaves for the provider and may never come back signed in — a
 * cancelled consent screen, a wrong directory, a closed tab. Writing the
 * badge at the moment of the hand-off made "last used" mean "last clicked",
 * so a provider somebody tried once and abandoned wore the badge forever.
 * The dial parks the method here instead, and it is promoted only when a
 * session actually exists.
 */
const PENDING_KEY = "langwatch.auth.pending-method";

export function readLastUsedMethodId(): string | null {
  try {
    // Swept here rather than in its own effect: this runs on every render of
    // the sign-in screen, which is exactly and only when the badge matters.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Remembers a method that actually got somebody in — a password sign-in that
 * came back without a failure, or a federated one promoted from the pending
 * slot once a session exists.
 */
export function rememberLastUsedMethod(method: Pick<SignInMethod, "id">): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, method.id);
  } catch {
    // A browser that will not store it simply does not get the badge.
  }
}

/** Parks a federated method while the browser is away at the provider. */
export function rememberPendingMethod(method: Pick<SignInMethod, "id">): void {
  try {
    window.localStorage.setItem(PENDING_KEY, method.id);
  } catch {
    // No badge, rather than a wrong one.
  }
}

/**
 * Turns a parked method into the badge, now that a session proves it worked.
 * A no-op when nothing is parked, so it is safe to call on every arrival.
 */
export function promotePendingMethod(): void {
  try {
    const pending = window.localStorage.getItem(PENDING_KEY);
    if (!pending) return;
    window.localStorage.removeItem(PENDING_KEY);
    window.localStorage.setItem(STORAGE_KEY, pending);
  } catch {
    // Nothing to promote if the store will not answer.
  }
}

/** Test seam, and the one place the key is written down. */
export const LAST_USED_METHOD_STORAGE_KEY = STORAGE_KEY;
