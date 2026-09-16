import {
  type LockoutPolicy,
  type LockoutState,
  NO_FAILED_ATTEMPTS,
  NO_LOCKOUT,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type LockoutEvidencePort,
  type LockoutIdentityPort,
  type LockoutPolicyPort,
  type LockoutStatePort,
  SignInLockoutService,
} from "../sign-in-lockout.service";

/**
 * Locking an address after repeated failed sign-ins, as the service actually
 * runs it (GAC-09, specs/identity/org-account-lockout.feature).
 *
 * The arithmetic is proved next door in `@langwatch/identity`. What is proved
 * HERE is everything the pure module cannot know: that an address with no
 * account is governed by something rather than by nothing, that one
 * organization's threshold does not reach another organization's members,
 * that the stored key is never the address, and that a deployment where
 * nobody has set a threshold does no work at all.
 */

const LOCKS_AT_FIVE: LockoutPolicy = {
  afterFailedAttempts: 5,
  lockMinutes: 30,
};

const NOW = new Date("2026-09-16T12:00:00.000Z");

/** A whole lock-out stack over in-memory state, with every read observable. */
function stackWhere({
  installationWide = NO_LOCKOUT,
  policiesByUser = {},
  accountsByAddress = {},
}: {
  installationWide?: LockoutPolicy;
  policiesByUser?: Record<string, LockoutPolicy>;
  accountsByAddress?: Record<string, string>;
} = {}) {
  const rows = new Map<string, LockoutState>();
  const stored: { userId: string | null }[] = [];
  const locked: { userId: string | null }[] = [];
  const escalated: { userId: string | null }[] = [];
  const reads: string[] = [];

  const state: LockoutStatePort = {
    read: async ({ identifierHash }) => {
      reads.push(identifierHash);
      return rows.get(identifierHash) ?? null;
    },
    write: async ({ identifierHash, state: next, userId }) => {
      rows.set(identifierHash, next);
      stored.push({ userId });
    },
    clear: async ({ identifierHash }) => {
      rows.delete(identifierHash);
    },
    clearForUser: async ({ userId }) => {
      // The administrator's release names a person; the rows are keyed by
      // address, so the stand-in drops every address that resolved to them.
      const theirs = Object.entries(accountsByAddress)
        .filter(([, owner]) => owner === userId)
        .map(([address]) => `hashed(${address})`);
      const cleared = theirs.filter((hash) => rows.delete(hash)).length;
      return cleared;
    },
  };

  const policy: LockoutPolicyPort = {
    forUser: async ({ userId }) => policiesByUser[userId] ?? NO_LOCKOUT,
    installationWide: async () => installationWide,
  };

  const identity: LockoutIdentityPort = {
    userIdFor: async ({ identifier }) => accountsByAddress[identifier] ?? null,
  };

  const evidence: LockoutEvidencePort = {
    locked: async ({ userId }) => {
      locked.push({ userId });
    },
    escalated: async ({ userId }) => {
      escalated.push({ userId });
    },
  };

  const service = new SignInLockoutService({
    state,
    policy,
    identity,
    evidence,
    // Distinguishable from the address, and reversible in the test only, so
    // an assertion can say "the address never went in" and mean it.
    hashIdentifier: (key) => `hashed(${key})`,
    now: () => NOW,
  });

  return { service, rows, stored, locked, escalated, reads };
}

const failTimes = async (
  service: SignInLockoutService,
  identifier: string,
  times: number,
) => {
  for (let attempt = 0; attempt < times; attempt++) {
    await service.recordFailure({ identifier });
  }
};

describe("given a deployment where no organization locks anybody", () => {
  describe("when somebody fails over and over", () => {
    /** @scenario "No threshold means no lock" */
    it("never locks them, and never even reads the state", async () => {
      const stack = stackWhere({ installationWide: NO_LOCKOUT });

      await failTimes(stack.service, "sam@acme.com", 20);
      await stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" });

      expect(stack.rows.size).toBe(0);
      // The early-out, asserted rather than assumed. This is what keeps the
      // whole feature off the sign-in path for every deployment that has not
      // turned it on.
      expect(stack.reads).toEqual([]);
    });
  });
});

describe("given an organization that locks after five attempts", () => {
  let stack: ReturnType<typeof stackWhere>;

  beforeEach(() => {
    stack = stackWhere({
      installationWide: LOCKS_AT_FIVE,
      policiesByUser: { "user-sam": LOCKS_AT_FIVE },
      accountsByAddress: { "sam@acme.com": "user-sam" },
    });
  });

  describe("when a member fails five times", () => {
    /** @scenario "The counter does not care which credential failed" */
    it("refuses the sixth attempt", async () => {
      await failTimes(stack.service, "sam@acme.com", 5);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "identity_sign_in_locked_out" });
    });

    it("lets the fifth attempt itself through", async () => {
      // The lock starts AFTER the fifth failure, not before it. Off by one
      // here would refuse somebody on the attempt that was allowed to fail.
      await failTimes(stack.service, "sam@acme.com", 4);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "A lock is an event, not just a log line" */
    it("records the lock against the person", async () => {
      await failTimes(stack.service, "sam@acme.com", 5);

      expect(stack.locked).toEqual([{ userId: "user-sam" }]);
    });

    it("records one lock, not one per failure after it", async () => {
      await failTimes(stack.service, "sam@acme.com", 9);

      expect(stack.locked).toHaveLength(1);
    });
  });

  describe("when they get in", () => {
    /** @scenario "Signing in successfully clears the count" */
    it("forgets the attempts entirely", async () => {
      await failTimes(stack.service, "sam@acme.com", 4);
      await stack.service.recordSuccess({ identifier: "sam@acme.com" });

      await failTimes(stack.service, "sam@acme.com", 4);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the same address is typed with different capitalisation", () => {
    it("counts the variations as one address", async () => {
      // Otherwise the counter is bypassed by holding down shift.
      await failTimes(stack.service, "sam@acme.com", 3);
      await failTimes(stack.service, "SAM@ACME.COM", 1);
      await failTimes(stack.service, " Sam@Acme.com ", 1);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "identity_sign_in_locked_out" });
    });
  });
});

describe("given an address that resolves to nobody", () => {
  describe("when somebody works through attempts against it", () => {
    /** @scenario "An address with no account locks exactly as one with an account" */
    it("locks it, and refuses it with the same code a real account gets", async () => {
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        accountsByAddress: {},
      });

      await failTimes(stack.service, "nobody@example.com", 5);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "nobody@example.com" }),
      ).rejects.toMatchObject({ code: "identity_sign_in_locked_out" });
    });

    /** @scenario "An address nobody holds is bound by the strictest rule on the installation" */
    it("is governed by the strictest rule anybody here has set", async () => {
      // The load-bearing case. An unknown address belongs to no organization,
      // so without this fallback it would never lock - and never locking is
      // itself the signal that an address has no account here.
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        accountsByAddress: {},
      });

      await failTimes(stack.service, "nobody@example.com", 4);
      await expect(
        stack.service.refuseIfLockedOut({ identifier: "nobody@example.com" }),
      ).resolves.toBeUndefined();

      await failTimes(stack.service, "nobody@example.com", 1);
      await expect(
        stack.service.refuseIfLockedOut({ identifier: "nobody@example.com" }),
      ).rejects.toMatchObject({ code: "identity_sign_in_locked_out" });
    });

    it("records the lock without a person on it", async () => {
      const stack = stackWhere({ installationWide: LOCKS_AT_FIVE });

      await failTimes(stack.service, "nobody@example.com", 5);

      // A run of these is an attack rather than a forgotten password, which
      // is exactly why they must be recorded rather than dropped for want of
      // somebody to file them against.
      expect(stack.locked).toEqual([{ userId: null }]);
    });
  });
});

describe("given two organizations that disagree", () => {
  describe("when a member of the lax one fails repeatedly", () => {
    /** @scenario "One organization's threshold does not lock another organization's members" */
    it("does not lock them", async () => {
      // The tenant boundary. `installationWide` locks at five because "acme"
      // set it; "gil" belongs only to an organization that set nothing.
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        policiesByUser: { "user-gil": NO_LOCKOUT },
        accountsByAddress: { "gil@globex.com": "user-gil" },
      });

      await failTimes(stack.service, "gil@globex.com", 20);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "gil@globex.com" }),
      ).resolves.toBeUndefined();
      expect(stack.locked).toEqual([]);
    });
  });
});

describe("given an address that keeps being locked out", () => {
  describe("when it reaches the fifth consecutive lock-out", () => {
    /** @scenario "The incident is distinguishable from the lock-outs that led to it" */
    it("records an escalation once, beside the ordinary locks", async () => {
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        policiesByUser: { "user-sam": LOCKS_AT_FIVE },
        accountsByAddress: { "sam@acme.com": "user-sam" },
      });

      await failTimes(stack.service, "sam@acme.com", 25);

      expect(stack.locked).toHaveLength(5);
      expect(stack.escalated).toEqual([{ userId: "user-sam" }]);
    });

    /** @scenario "A fifth consecutive lock-out stops lifting by itself" */
    it("keeps refusing it", async () => {
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        policiesByUser: { "user-sam": LOCKS_AT_FIVE },
        accountsByAddress: { "sam@acme.com": "user-sam" },
      });

      await failTimes(stack.service, "sam@acme.com", 25);

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "identity_sign_in_locked_out" });
    });

    /** @scenario "Proving you own the mailbox clears a held account" */
    it("is cleared by a password reset", async () => {
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        policiesByUser: { "user-sam": LOCKS_AT_FIVE },
        accountsByAddress: { "sam@acme.com": "user-sam" },
      });
      await failTimes(stack.service, "sam@acme.com", 25);

      await stack.service.clearAfterMailboxProof({
        identifier: "sam@acme.com",
      });

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "sam@acme.com" }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given anything at all is written down about an attempt", () => {
  describe("when the state is stored", () => {
    /** @scenario "Nothing recorded carries the credential that was tried" */
    it("stores the address only as its keyed hash", async () => {
      const stack = stackWhere({
        installationWide: LOCKS_AT_FIVE,
        accountsByAddress: {},
      });

      await failTimes(stack.service, "sam@acme.com", 1);

      const keys = [...stack.rows.keys()];
      expect(keys).toEqual(["hashed(sam@acme.com)"]);
      // The property that matters is that the raw address is not a key. The
      // real hasher is an HMAC under the deployment's own secret; this stand
      // -in only has to be distinguishable from the address itself.
      expect(keys).not.toContain("sam@acme.com");
    });
  });
});

describe("given nothing has ever failed against an address", () => {
  describe("when it is checked", () => {
    it("is allowed through", async () => {
      const stack = stackWhere({ installationWide: LOCKS_AT_FIVE });

      await expect(
        stack.service.refuseIfLockedOut({ identifier: "fresh@acme.com" }),
      ).resolves.toBeUndefined();
      expect(NO_FAILED_ATTEMPTS.failedCount).toBe(0);
    });
  });
});
