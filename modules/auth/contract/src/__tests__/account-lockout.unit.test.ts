import {
  afterFailedAttempt,
  afterMailboxProof,
  afterSuccessfulSignIn,
  lockoutVerdict,
  NO_FAILED_ATTEMPTS,
  NO_LOCKOUT,
  signInIdentifierKey,
  strictestLockoutPolicy,
  type LockoutPolicy,
  type LockoutState,
} from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

const AT = Temporal.Instant.from("2026-03-01T09:00:00.000Z");
const minutesAfter = (minutes: number) => AT.add({ minutes });

const locksAfter = (afterFailedAttempts: number, lockMinutes = 30): LockoutPolicy => ({
  afterFailedAttempts,
  lockMinutes,
});

const fail = ({
  times,
  policy,
  from = NO_FAILED_ATTEMPTS,
  at = AT,
}: {
  times: number;
  policy: LockoutPolicy;
  from?: LockoutState;
  at?: Instant;
}): LockoutState => {
  let state = from;
  for (let attempt = 0; attempt < times; attempt += 1) {
    state = afterFailedAttempt({ state, policy, now: at });
  }

  return state;
};

describe("the account lock-out decision", () => {
  /** @scenario "No threshold means no lock" */
  it("never locks an address whose organizations set no threshold", () => {
    const state = fail({ times: 20, policy: NO_LOCKOUT });

    expect(state.failedCount).toBe(20);
    expect(lockoutVerdict({ state, now: AT })).toEqual({ locked: false });
  });

  /** @scenario "The counter does not care which credential failed" */
  it("locks on the attempt that reaches the threshold, whatever failed", () => {
    const state = fail({ times: 5, policy: locksAfter(5) });

    expect(lockoutVerdict({ state, now: AT })).toMatchObject({ locked: true, held: false });
  });

  /** @scenario "Signing in successfully clears the count" */
  it("puts the count back to zero on a success", () => {
    const failed = fail({ times: 4, policy: locksAfter(5) });

    expect(failed.failedCount).toBe(4);
    expect(afterSuccessfulSignIn()).toEqual(NO_FAILED_ATTEMPTS);
  });

  /** @scenario "The tightest threshold among a person's organizations applies" */
  it("takes the lowest threshold and the longest lock among the organizations", () => {
    expect(strictestLockoutPolicy([locksAfter(5, 30), locksAfter(10, 60)])).toEqual({
      afterFailedAttempts: 5,
      lockMinutes: 60,
    });
  });

  /** @scenario "One organization's threshold does not lock another organization's members" */
  it("asks nothing when no organization among them locks", () => {
    expect(strictestLockoutPolicy([NO_LOCKOUT, NO_LOCKOUT])).toEqual(NO_LOCKOUT);
  });

  /** @scenario "The lock lifts when the period is over" */
  it("lifts the lock once the period has run", () => {
    const state = fail({ times: 5, policy: locksAfter(5, 30) });

    expect(lockoutVerdict({ state, now: minutesAfter(31) })).toEqual({ locked: false });
  });

  /** @scenario "A fifth consecutive lock-out stops lifting by itself" */
  it("holds the address once five consecutive locks have been taken", () => {
    let state = NO_FAILED_ATTEMPTS;
    for (let round = 0; round < 5; round += 1) {
      state = fail({ times: 5, policy: locksAfter(5, 30), from: state });
    }

    expect(state).toMatchObject({ consecutiveLockouts: 5, heldForReview: true });
    expect(lockoutVerdict({ state, now: minutesAfter(60 * 24) })).toEqual({
      locked: true,
      until: null,
      held: true,
    });
  });

  /** @scenario "Proving you own the mailbox clears a held account" */
  it("clears a held address on a proved mailbox", () => {
    expect(lockoutVerdict({ state: afterMailboxProof(), now: AT })).toEqual({ locked: false });
  });

  it("folds the case of the address, so alternating it is not a second budget", () => {
    expect(signInIdentifierKey("  Sam@Acme.com ")).toBe("sam@acme.com");
  });

  it("keeps dots and tags, which name different accounts here", () => {
    expect(signInIdentifierKey("sam.jones+ci@acme.com")).toBe("sam.jones+ci@acme.com");
  });
});
