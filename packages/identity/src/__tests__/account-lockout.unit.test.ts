import { describe, expect, it } from "vitest";
import {
  afterFailedAttempt,
  afterMailboxProof,
  afterSuccessfulSignIn,
  CONSECUTIVE_LOCKOUT_CEILING,
  type LockoutPolicy,
  type LockoutState,
  lockoutVerdict,
  NO_FAILED_ATTEMPTS,
  NO_LOCKOUT,
  signInIdentifierKey,
  strictestLockoutPolicy,
} from "../account-lockout";

/**
 * The arithmetic behind locking an account after repeated failed sign-ins
 * (GAC-09, specs/identity/org-account-lockout.feature).
 *
 * Every case here is a number and a clock, which is the point of keeping the
 * decision pure: "a fifth consecutive lock-out stops lifting by itself" is
 * twenty-five failures and two and a half hours of waiting to demonstrate
 * against a real sign-in, and three lines here.
 */

const LOCKS_AT_FIVE: LockoutPolicy = {
  afterFailedAttempts: 5,
  lockMinutes: 30,
};

const NOW = new Date("2026-09-16T12:00:00.000Z");
const minutesAfter = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000);

/** Fail `times` times in a row against a fresh address. */
function failRepeatedly({
  times,
  policy = LOCKS_AT_FIVE,
  from = NO_FAILED_ATTEMPTS,
  now = NOW,
}: {
  times: number;
  policy?: LockoutPolicy;
  from?: LockoutState;
  now?: Date;
}): LockoutState {
  let state = from;
  for (let attempt = 0; attempt < times; attempt++) {
    state = afterFailedAttempt({ state, policy, now });
  }
  return state;
}

describe("given an organization that has never configured a threshold", () => {
  describe("when somebody fails over and over", () => {
    /** @scenario "No threshold means no lock" */
    it("never locks them out", () => {
      const state = failRepeatedly({ times: 20, policy: NO_LOCKOUT });

      expect(state.failedCount).toBe(20);
      expect(state.lockedUntil).toBeNull();
      expect(lockoutVerdict({ state, now: NOW })).toEqual({ locked: false });
    });
  });
});

describe("given an organization that locks after five attempts", () => {
  describe("when the failures come in", () => {
    /** @scenario "The counter does not care which credential failed" */
    it("counts them into one number and locks at five", () => {
      // The decision never learns which credential was wrong, which IS the
      // guarantee: a counter that could tell them apart is a counter somebody
      // would eventually give one budget each.
      const state = failRepeatedly({ times: 5 });

      const verdict = lockoutVerdict({ state, now: NOW });
      expect(verdict.locked).toBe(true);
      expect(state.consecutiveLockouts).toBe(1);
    });

    it("does not lock on the fourth", () => {
      const state = failRepeatedly({ times: 4 });

      expect(lockoutVerdict({ state, now: NOW })).toEqual({ locked: false });
    });
  });

  describe("when they get in", () => {
    /** @scenario "Signing in successfully clears the count" */
    it("puts the count back to zero", () => {
      const nearlyLocked = failRepeatedly({ times: 4 });
      expect(nearlyLocked.failedCount).toBe(4);

      expect(afterSuccessfulSignIn()).toEqual(NO_FAILED_ATTEMPTS);
    });

    it("breaks the run of lock-outs as well as the run of failures", () => {
      // Without this, `consecutiveLockouts` is a lifetime tally and an account
      // that has been locked four times over two years is one bad afternoon
      // away from being held forever.
      const locked = failRepeatedly({ times: 10 });
      expect(locked.consecutiveLockouts).toBe(2);

      expect(afterSuccessfulSignIn().consecutiveLockouts).toBe(0);
    });
  });

  describe("when the lock-out period is over", () => {
    /** @scenario "The lock lifts when the period is over" */
    it("lets them try again, with the count back to zero", () => {
      const state = failRepeatedly({ times: 5 });

      expect(lockoutVerdict({ state, now: minutesAfter(31) })).toEqual({
        locked: false,
      });
      expect(state.failedCount).toBe(0);
    });

    it("is still locked a minute before", () => {
      const state = failRepeatedly({ times: 5 });

      expect(lockoutVerdict({ state, now: minutesAfter(29) })).toMatchObject({
        locked: true,
        held: false,
      });
    });
  });
});

describe("given an address locked out over and over without ever getting in", () => {
  describe("when it reaches the fifth consecutive lock-out", () => {
    /** @scenario "A fifth consecutive lock-out stops lifting by itself" */
    it("stops lifting when the period is over", () => {
      const state = failRepeatedly({ times: 5 * CONSECUTIVE_LOCKOUT_CEILING });

      expect(state.consecutiveLockouts).toBe(CONSECUTIVE_LOCKOUT_CEILING);
      expect(state.heldForReview).toBe(true);
      // A year later, still held. Waiting is not the remedy any more.
      expect(
        lockoutVerdict({ state, now: minutesAfter(60 * 24 * 365) }),
      ).toEqual({ locked: true, until: null, held: true });
    });

    /** @scenario "The incident is distinguishable from the lock-outs that led to it" */
    it("is distinguishable from the four ordinary lock-outs before it", () => {
      const fourth = failRepeatedly({
        times: 5 * (CONSECUTIVE_LOCKOUT_CEILING - 1),
      });
      const fifth = failRepeatedly({ times: 5, from: fourth });

      // The property an alert is built on: the fourth is routine and the
      // fifth is an incident, and they are told apart by a field rather than
      // by counting log lines.
      expect(fourth.heldForReview).toBe(false);
      expect(fifth.heldForReview).toBe(true);
      expect(lockoutVerdict({ state: fourth, now: minutesAfter(31) })).toEqual({
        locked: false,
      });
    });
  });

  describe("when the owner proves they hold the mailbox", () => {
    /** @scenario "Proving you own the mailbox clears a held account" */
    it("clears the hold", () => {
      const held = failRepeatedly({ times: 5 * CONSECUTIVE_LOCKOUT_CEILING });
      expect(held.heldForReview).toBe(true);

      const cleared = afterMailboxProof();

      expect(cleared.heldForReview).toBe(false);
      expect(lockoutVerdict({ state: cleared, now: NOW })).toEqual({
        locked: false,
      });
    });
  });
});

describe("given somebody who belongs to more than one organization", () => {
  describe("when the organizations disagree", () => {
    /** @scenario "The tightest threshold among a person's organizations applies" */
    it("takes the tightest threshold and the longest lock", () => {
      expect(
        strictestLockoutPolicy([
          { afterFailedAttempts: 5, lockMinutes: 30 },
          { afterFailedAttempts: 10, lockMinutes: 60 },
        ]),
      ).toEqual({ afterFailedAttempts: 5, lockMinutes: 60 });
    });

    it("does not let an organization that locks nobody loosen one that does", () => {
      // The asymmetry the whole merge exists for. A person who joins a lax
      // organization must not thereby escape their employer's rule.
      expect(
        strictestLockoutPolicy([LOCKS_AT_FIVE, NO_LOCKOUT]),
      ).toMatchObject({ afterFailedAttempts: 5 });
    });
  });

  describe("when none of them asks for anything", () => {
    it("locks nobody", () => {
      expect(strictestLockoutPolicy([NO_LOCKOUT, NO_LOCKOUT])).toEqual(
        NO_LOCKOUT,
      );
      expect(strictestLockoutPolicy([])).toEqual(NO_LOCKOUT);
    });
  });
});

describe("given the same address typed differently", () => {
  describe("when the counter keys it", () => {
    it("treats the variations as one address", () => {
      // Otherwise the counter is bypassed by holding down shift: five
      // attempts at one spelling, five at the next, indefinitely.
      expect(signInIdentifierKey("  Sam@Acme.com ")).toBe("sam@acme.com");
      expect(signInIdentifierKey("SAM@ACME.COM")).toBe(
        signInIdentifierKey("sam@acme.com"),
      );
    });

    it("keeps addresses this product treats as different apart", () => {
      // Stripping dots or `+tags` would fold addresses that are separate
      // accounts here, locking people out of accounts nobody was attacking.
      expect(signInIdentifierKey("sam+work@acme.com")).not.toBe(
        signInIdentifierKey("sam@acme.com"),
      );
      expect(signInIdentifierKey("s.am@acme.com")).not.toBe(
        signInIdentifierKey("sam@acme.com"),
      );
    });
  });
});
