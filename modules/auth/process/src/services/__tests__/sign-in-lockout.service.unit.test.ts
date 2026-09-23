import {
  NO_LOCKOUT,
  NO_SESSION_BOUND,
  SignInLockedOutError,
  type LockoutPolicy,
} from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { signInSecurityFixture } from "./sign-in-security.fixture.ts";

const locksAfter = (afterFailedAttempts: number, lockMinutes = 30): LockoutPolicy => ({
  afterFailedAttempts,
  lockMinutes,
});

let clock = Temporal.Instant.from("2026-03-01T09:00:00.000Z");
const now = () => clock;
const passes = (minutes: number) => {
  clock = clock.add({ minutes });
};

const build = () => signInSecurityFixture({ now });

beforeEach(() => {
  clock = Temporal.Instant.from("2026-03-01T09:00:00.000Z");
});

const failTimes = async (
  lockout: ReturnType<typeof build>["lockout"],
  identifier: string,
  times: number,
) => {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await lockout.recordFailure({ identifier });
  }
};

describe("locking an address after repeated failed sign-ins", () => {
  /** @scenario "No threshold means no lock" */
  it("counts nothing on an installation where no organization locks", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: NO_LOCKOUT,
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    await failTimes(fixture.lockout, "sam@acme.com", 20);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).resolves.toBeUndefined();
    expect(fixture.locks.rows.size).toBe(0);
  });

  /** @scenario "The counter does not care which credential failed" */
  it("refuses the next attempt once the threshold is reached", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    await failTimes(fixture.lockout, "sam@acme.com", 5);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).rejects.toBeInstanceOf(SignInLockedOutError);
  });

  /** @scenario "The answer never says which half was wrong" */
  it("refuses a correct password with the same answer, naming no credential", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    await failTimes(fixture.lockout, "sam@acme.com", 5);

    const refusal = await fixture.lockout
      .refuseIfLockedOut({ identifier: "sam@acme.com" })
      .catch((error: unknown) => error);

    if (!(refusal instanceof HandledError)) throw new Error("the lock did not refuse");
    expect(refusal.code).toBe("identity_sign_in_locked_out");
    expect(JSON.stringify(refusal)).not.toContain("sam@acme.com");
  });

  /** @scenario "Signing in successfully clears the count" */
  it("clears everything on a success", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    await failTimes(fixture.lockout, "sam@acme.com", 4);

    await fixture.lockout.recordSuccess({ identifier: "sam@acme.com" });

    expect(fixture.locks.rows.size).toBe(0);
  });

  /** @scenario "An address with no account locks exactly as one with an account" */
  it("locks an address with no account behind it", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
    });

    await failTimes(fixture.lockout, "nobody@example.com", 5);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "nobody@example.com" }),
    ).rejects.toBeInstanceOf(SignInLockedOutError);
  });

  /** @scenario "An address nobody holds is bound by the strictest rule on the installation" */
  it("applies the installation's strictest threshold to an unknown address", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
    });

    await failTimes(fixture.lockout, "nobody@example.com", 4);
    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "nobody@example.com" }),
    ).resolves.toBeUndefined();

    await failTimes(fixture.lockout, "nobody@example.com", 1);
    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "nobody@example.com" }),
    ).rejects.toBeInstanceOf(SignInLockedOutError);
  });

  /** @scenario "One organization's threshold does not lock another organization's members" */
  it("leaves a member of a non-locking organization unlocked", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
    });
    await fixture.organization({
      id: "globex",
      lockout: NO_LOCKOUT,
      sessionBound: NO_SESSION_BOUND,
      members: ["gil"],
    });
    fixture.account({ identifier: "gil@globex.com", userId: "gil" });

    await failTimes(fixture.lockout, "gil@globex.com", 5);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "gil@globex.com" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "The tightest threshold among a person's organizations applies" */
  it("locks at the tighter of a person's two organizations", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    await fixture.organization({
      id: "globex",
      lockout: locksAfter(10),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    await failTimes(fixture.lockout, "sam@acme.com", 5);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).rejects.toBeInstanceOf(SignInLockedOutError);
  });

  /** @scenario "The lock lifts when the period is over" */
  it("lets the address try again once the period has run", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    await failTimes(fixture.lockout, "sam@acme.com", 5);

    passes(31);

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "A fifth consecutive lock-out stops lifting by itself" */
  it("holds the address after a fifth consecutive lock, and waiting does not release it", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    for (let round = 0; round < 5; round += 1) {
      await failTimes(fixture.lockout, "sam@acme.com", 5);
      passes(31);
    }

    passes(60 * 24);
    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).rejects.toBeInstanceOf(SignInLockedOutError);
  });

  /** @scenario "Proving you own the mailbox clears a held account" */
  it("clears a hold when the owner proved the mailbox", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    for (let round = 0; round < 5; round += 1) {
      await failTimes(fixture.lockout, "sam@acme.com", 5);
      passes(31);
    }

    await fixture.lockout.clearAfterMailboxProof({ identifier: "sam@acme.com" });

    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "An administrator can release a held account" */
  it("releases every row an administrator's person holds", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    await failTimes(fixture.lockout, "sam@acme.com", 5);

    expect(await fixture.lockout.release({ userId: "sam" })).toBe(1);
    await expect(
      fixture.lockout.refuseIfLockedOut({ identifier: "sam@acme.com" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "A lock is an event, not just a log line" */
  it("records the lock with the count that caused it", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    await failTimes(fixture.lockout, "sam@acme.com", 5);

    expect(fixture.recorded.locked).toEqual([
      {
        userId: "sam",
        failedCount: 5,
        consecutiveLockouts: 1,
        lockedUntil: now().add({ minutes: 30 }),
      },
    ]);
  });

  /** @scenario "The incident is distinguishable from the lock-outs that led to it" */
  it("records the ceiling separately from the locks that reached it", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    for (let round = 0; round < 5; round += 1) {
      await failTimes(fixture.lockout, "sam@acme.com", 5);
      passes(31);
    }

    expect(fixture.recorded.locked).toHaveLength(5);
    expect(fixture.recorded.escalated).toEqual([{ userId: "sam", consecutiveLockouts: 5 }]);
  });

  /** @scenario "Nothing recorded carries the credential that was tried" */
  it("stores a keyed hash and never the address itself", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });

    await failTimes(fixture.lockout, "sam@acme.com", 5);

    expect([...fixture.locks.rows.keys()]).toEqual(["keyed:sam@acme.com"]);
    expect(JSON.stringify([...fixture.locks.rows.values()])).not.toContain("@acme.com");
    expect(JSON.stringify(fixture.recorded)).not.toContain("@acme.com");
  });

  it("reaps the rows that have stopped meaning anything, and never a held one", async () => {
    const fixture = build();
    await fixture.organization({
      id: "acme",
      lockout: locksAfter(5, 30),
      sessionBound: NO_SESSION_BOUND,
      members: ["sam"],
    });
    fixture.account({ identifier: "sam@acme.com", userId: "sam" });
    await failTimes(fixture.lockout, "sam@acme.com", 5);
    await failTimes(fixture.lockout, "nobody@example.com", 1);

    passes(60 * 24 * 2);
    const settledBefore = now();

    expect(await fixture.lockout.reapSettledLocks({ settledBefore })).toBe(2);
    expect(fixture.locks.rows.size).toBe(0);
  });
});
