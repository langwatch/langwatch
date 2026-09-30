/**
 * Locking an account after repeated failed sign-ins (GAC-09).
 * Spec: specs/identity/org-account-lockout.feature.
 *
 * WHY THIS IS NOT THE RATE LIMITER. Sign-in is already throttled - fifty
 * attempts per fifteen minutes on the password path. A throttle bounds a
 * PATH: it forgets, it applies to whoever is calling rather than to whose
 * account is being tried, and somebody who paces themselves is never stopped
 * by it. A lock is a decision about one account that persists, that an
 * administrator can see, and that ends in an event somebody can alert on.
 * Both stay; the throttle is the ceiling on volume and the lock is the answer
 * to persistence.
 *
 * Every function here is pure. What is deliberately NOT here: reading the
 * state, writing it, hashing the address and emitting the event, all of which
 * need a database, a secret and a clock. This module is only the decision, so
 * the cases that matter - the fifth consecutive lock, the address with no
 * account behind it - can be tested as arithmetic rather than against a
 * sign-in.
 */

/** What an organization asks of the sign-ins of its members. */
export interface LockoutPolicy {
  /**
   * Consecutive failures that take a lock. ZERO MEANS NEVER LOCK, and is the
   * default every organization keeps until an administrator sets it.
   */
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
 * The ceiling the control names: at five consecutive locks the account stops
 * unlocking by itself and becomes an incident instead.
 *
 * Four locks is somebody who has forgotten their password. Twenty-five
 * failures across five locks is somebody working through a list, and
 * releasing the account every half hour simply hands them the next window.
 */
export const CONSECUTIVE_LOCKOUT_CEILING = 5;

/**
 * The tightest rule among the organizations a person belongs to.
 *
 * A person has one way of signing in and may belong to several
 * organizations, so this cannot be decided per organization. An organization
 * may tighten how its people sign in; it may not loosen what another
 * organization already requires of them - so a zero (never lock) never wins
 * over a real threshold, and the longest lock among those that do lock is the
 * one that applies.
 */
export function strictestLockoutPolicy(
  policies: readonly LockoutPolicy[],
): LockoutPolicy {
  const locking = policies.filter((policy) => policy.afterFailedAttempts > 0);
  if (locking.length === 0) return NO_LOCKOUT;
  return {
    afterFailedAttempts: Math.min(
      ...locking.map((policy) => policy.afterFailedAttempts),
    ),
    lockMinutes: Math.max(...locking.map((policy) => policy.lockMinutes)),
  };
}

/** What has happened to one address so far. */
export interface LockoutState {
  /**
   * Failures since the last success. CONSECUTIVE, not cumulative: without
   * that, the threshold becomes a lifetime budget and every long-lived
   * account eventually trips it.
   */
  failedCount: number;
  /** When the current lock lifts, or null when there is no lock. */
  lockedUntil: Date | null;
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
      /**
       * When they may try again, or null when the account is held and no
       * amount of waiting will release it.
       */
      until: Date | null;
      /** Whether the ceiling put it here, rather than an ordinary lock. */
      held: boolean;
    };

/**
 * Whether a sign-in may be attempted for this address.
 *
 * Asked of the address that was TYPED rather than of an account, which is the
 * property the whole feature rests on - see `heldForReview`'s note in the
 * schema and the "never an account-existence oracle" scenario. An address
 * with nothing behind it reaches this function with a state of its own and is
 * answered exactly as one that resolves.
 */
export function lockoutVerdict({
  state,
  now,
}: {
  state: LockoutState;
  now: Date;
}): LockoutVerdict {
  if (state.heldForReview) return { locked: true, until: null, held: true };
  if (state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime()) {
    return { locked: true, until: state.lockedUntil, held: false };
  }
  return { locked: false };
}

/**
 * The state after one failed attempt.
 *
 * Every credential counts into the same number - a password, a one-time code,
 * a backup code, a passkey. Five per method would hand an attacker one budget
 * per factor, which is the opposite of what a second factor is for.
 */
export function afterFailedAttempt({
  state,
  policy,
  now,
}: {
  state: LockoutState;
  policy: LockoutPolicy;
  now: Date;
}): LockoutState {
  const failedCount = state.failedCount + 1;
  if (
    policy.afterFailedAttempts <= 0 ||
    failedCount < policy.afterFailedAttempts
  ) {
    return { ...state, failedCount };
  }

  const consecutiveLockouts = state.consecutiveLockouts + 1;
  return {
    // Back to zero, so the next window starts fresh rather than tripping the
    // threshold again on the very next attempt after the lock lifts.
    failedCount: 0,
    lockedUntil: new Date(now.getTime() + policy.lockMinutes * 60_000),
    consecutiveLockouts,
    heldForReview: consecutiveLockouts >= CONSECUTIVE_LOCKOUT_CEILING,
  };
}

/**
 * The state after somebody actually got in.
 *
 * Everything resets, the count of locks included: "five consecutive" is only
 * meaningful if a success breaks the run.
 */
export function afterSuccessfulSignIn(): LockoutState {
  return NO_FAILED_ATTEMPTS;
}

/**
 * The state after the owner proved they hold the mailbox.
 *
 * The way out of a held account that does not need an administrator, and the
 * reason a hold is not a denial of service anybody can inflict by typing a
 * colleague's address wrong often enough: clearing it costs mailbox control,
 * which is exactly what the attacker does not have.
 */
export function afterMailboxProof(): LockoutState {
  return NO_FAILED_ATTEMPTS;
}

/**
 * The address as the counter keys it.
 *
 * Case-folded and trimmed, because otherwise the counter is bypassed by
 * typing the same address with a capital letter - five attempts at
 * `sam@acme.com`, five more at `Sam@acme.com`, and so on for as long as the
 * attacker cares to alternate.
 *
 * Nothing more clever than that. Stripping dots or `+tags` would fold
 * addresses that this product treats as different accounts, so the counter
 * would lock people out of accounts they were not trying.
 */
export function signInIdentifierKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}
