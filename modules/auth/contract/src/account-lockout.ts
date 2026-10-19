/**
 * Locking an account after repeated failed sign-ins (GAC-09).
 * Spec: specs/identity/org-account-lockout.feature, which carries why this is
 * not the rate limiter and why the count is kept against the typed address.
 */

import type { Instant } from "@langwatch/time";

/** What an organization asks of its members' sign-ins. */
export interface LockoutPolicy {
  /** Consecutive failures that take a lock. ZERO MEANS NEVER LOCK, and is
   *  what every organization keeps until an administrator sets it. */
  afterFailedAttempts: number;
  /** How long a lock lasts. Meaningless while the threshold is zero. */
  lockMinutes: number;
}

/** What an organization that has never configured this asks: nothing. */
export const NO_LOCKOUT: LockoutPolicy = {
  afterFailedAttempts: 0,
  lockMinutes: 30,
};

/**
 * At five consecutive locks the account stops lifting by itself and becomes
 * an incident: four locks is a forgotten password, and twenty-five failures
 * across five is somebody working through a list.
 */
export const CONSECUTIVE_LOCKOUT_CEILING = 5;

/**
 * The tightest rule among a person's organizations. One person, one way in:
 * an organization may tighten how its people sign in and never loosen what
 * another already requires - so a zero never wins over a real threshold.
 */
export function strictestLockoutPolicy(policies: readonly LockoutPolicy[]): LockoutPolicy {
  const locking = policies.filter((policy) => policy.afterFailedAttempts > 0);
  if (locking.length === 0) return NO_LOCKOUT;

  return {
    afterFailedAttempts: Math.min(...locking.map((policy) => policy.afterFailedAttempts)),
    lockMinutes: Math.max(...locking.map((policy) => policy.lockMinutes)),
  };
}

/** What has happened to one address so far. */
export interface LockoutState {
  /** Failures since the last success. CONSECUTIVE, not cumulative: otherwise
   *  the threshold is a lifetime budget every old account eventually trips. */
  failedCount: number;
  /** When the current lock lifts, or null when there is no lock. */
  lockedUntil: Instant | null;
  /** Locks taken since the last success. */
  consecutiveLockouts: number;
  /** Whether the ceiling was reached and the lock has stopped lifting. */
  heldForReview: boolean;
}

/** An address nobody has failed against. */
export const NO_FAILED_ATTEMPTS: LockoutState = {
  failedCount: 0,
  lockedUntil: null,
  consecutiveLockouts: 0,
  heldForReview: false,
};

/** Whether this address may try at all right now, and until when if not. */
export type LockoutVerdict =
  | { locked: false }
  | {
      locked: true;
      /** When they may try again, or null when the account is held and no
       *  amount of waiting releases it. */
      until: Instant | null;
      /** Whether the ceiling put it here, rather than an ordinary lock. */
      held: boolean;
    };

/**
 * Whether a sign-in may be attempted for this address. Asked of the address
 * that was TYPED rather than of an account, so one with nothing behind it is
 * answered exactly as one that resolves - the property the feature rests on.
 */
export function lockoutVerdict({
  state,
  now,
}: {
  state: LockoutState;
  now: Instant;
}): LockoutVerdict {
  if (state.heldForReview) return { locked: true, until: null, held: true };
  if (state.lockedUntil !== null && state.lockedUntil.epochMilliseconds > now.epochMilliseconds) {
    return { locked: true, until: state.lockedUntil, held: false };
  }

  return { locked: false };
}

/**
 * The state after one failed attempt. Every credential counts into the same
 * number - password, one-time code, backup code, passkey - because a budget
 * each hands an attacker one budget per factor.
 */
export function afterFailedAttempt({
  state,
  policy,
  now,
}: {
  state: LockoutState;
  policy: LockoutPolicy;
  now: Instant;
}): LockoutState {
  const failedCount = state.failedCount + 1;
  if (policy.afterFailedAttempts <= 0 || failedCount < policy.afterFailedAttempts) {
    return { ...state, failedCount };
  }

  const consecutiveLockouts = state.consecutiveLockouts + 1;
  return {
    // Back to zero, so the next window starts fresh rather than tripping the
    // threshold again on the first attempt after the lock lifts.
    failedCount: 0,
    lockedUntil: now.add({ minutes: policy.lockMinutes }),
    consecutiveLockouts,
    heldForReview: consecutiveLockouts >= CONSECUTIVE_LOCKOUT_CEILING,
  };
}

/**
 * The state after somebody actually got in. Everything resets, the count of
 * locks included: "five consecutive" only means anything if a success breaks
 * the run.
 */
export function afterSuccessfulSignIn(): LockoutState {
  return NO_FAILED_ATTEMPTS;
}

/**
 * The state after the owner proved they hold the mailbox - the way out of a
 * held account that needs no administrator, and what keeps a hold from being
 * a denial of service anyone can inflict by mistyping a colleague's address.
 */
export function afterMailboxProof(): LockoutState {
  return NO_FAILED_ATTEMPTS;
}

/**
 * The address as the counter keys it: case-folded and trimmed, else
 * `sam@acme.com` and `Sam@acme.com` are two budgets. Nothing cleverer -
 * stripping dots or `+tags` would fold accounts this product keeps apart.
 */
export function signInIdentifierKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}
