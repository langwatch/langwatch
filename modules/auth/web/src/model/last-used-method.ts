import type { SignInMethod } from "@langwatch/identity-contract";

/** Last-used sign-in method badge (device-local, never account-linked). */
const STORAGE_KEY = "langwatch.auth.last-used-method.v2";
const LEGACY_STORAGE_KEY = "langwatch.auth.last-used-method";

/** Pending federated method; promoted only when session confirms sign-in. */
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
