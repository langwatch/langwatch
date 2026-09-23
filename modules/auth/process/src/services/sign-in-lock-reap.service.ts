import { Temporal, nowInstant, type Instant } from "@langwatch/time";

import type { SignInAttemptLockRepository } from "../repositories/sign-in-attempt-lock.repository.ts";

/**
 * How long a finished row is kept. Not zero: the count is what tells five
 * failures in ten minutes from five in a year, and a day outlasts the longest
 * lock an administrator can set. Spec: specs/identity/org-account-lockout.feature.
 */
export const SIGN_IN_LOCK_RETENTION = Temporal.Duration.from({ hours: 24 });

/** Clears the lock-out rows that have stopped meaning anything. Releases nothing. */
export class SignInLockReapService {
  private constructor(
    private readonly locks: SignInAttemptLockRepository,
    private readonly now: () => Instant,
  ) {}

  static create({
    locks,
    now = nowInstant,
  }: {
    locks: SignInAttemptLockRepository;
    now?: () => Instant;
  }): SignInLockReapService {
    return new SignInLockReapService(locks, now);
  }

  /** Removes every settled row untouched for a day; answers how many went. */
  async reap(): Promise<number> {
    return this.locks.deleteSettled({
      settledBefore: this.now().subtract(SIGN_IN_LOCK_RETENTION),
    });
  }
}
