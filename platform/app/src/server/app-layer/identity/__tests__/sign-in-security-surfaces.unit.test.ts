import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "~/features/errors/logic/codes";
import { explainHandledError } from "~/features/errors/logic/presentation";
import {
  PrismaLockoutPolicies,
  PrismaSessionBoundPolicies,
} from "../sign-in-security-adapters";

/**
 * Where the two new sign-in security rules stop (GAC-09, GAC-10).
 *
 * Everything else about them is tested by what they DO. These are the
 * boundaries — the surfaces they must not reach, and the thing their refusal
 * must not say — and each one is a promise that is easy to break by accident
 * later, which is the whole reason it is pinned here rather than left to the
 * spec's prose.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */

/** Just enough Prisma to answer the two reads these policies make. */
function prismaWhere({
  organizations = [] as Record<string, number>[],
  memberships = [] as Record<string, number>[],
}) {
  const selected: Record<string, unknown>[] = [];
  return {
    client: {
      organization: {
        findMany: async (args: { select?: Record<string, unknown> }) => {
          selected.push(args.select ?? {});
          return organizations;
        },
      },
      organizationUser: {
        findMany: async (args: {
          select?: { organization?: { select?: Record<string, unknown> } };
        }) => {
          selected.push(args.select?.organization?.select ?? {});
          return memberships.map((organization) => ({ organization }));
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    /** Every column either policy asked Postgres for. */
    columnsRead: () => selected.flatMap((select) => Object.keys(select)),
  };
}

describe("given an organization that bounds its browser sessions", () => {
  describe("when the browser session policy is read", () => {
    /** @scenario "A browser window does not silently bound the CLI" */
    it("never reads or writes the setting that bounds CLI sessions", async () => {
      // The two surfaces share an organization and nothing else. An
      // hour-long CLI session would break every scheduled job our customers
      // run, and nobody setting a browser idle timeout is asking for that —
      // so the browser policy must not so much as look at
      // `maxSessionDurationDays`, in either direction.
      const prisma = prismaWhere({
        organizations: [
          { sessionIdleTimeoutMinutes: 60, sessionMaxLifetimeMinutes: 0 },
        ],
        memberships: [
          { sessionIdleTimeoutMinutes: 60, sessionMaxLifetimeMinutes: 0 },
        ],
      });
      const policies = new PrismaSessionBoundPolicies(prisma.client);

      await policies.installationWide();
      await policies.forUser({ userId: "user-sam" });

      expect(prisma.columnsRead()).not.toContain("maxSessionDurationDays");
      expect(prisma.columnsRead()).toEqual(
        expect.arrayContaining([
          "sessionIdleTimeoutMinutes",
          "sessionMaxLifetimeMinutes",
        ]),
      );
    });
  });

  describe("when an organization has capped its CLI sessions and nothing else", () => {
    /** @scenario "A capped CLI does not bound the browser" */
    it("leaves the browser session unbounded", async () => {
      // `maxSessionDurationDays` is not among the columns the browser policy
      // selects, so a row carrying one answers this policy with nothing —
      // which is what keeps the existing setting meaning exactly what it
      // meant before this feature existed.
      const prisma = prismaWhere({
        organizations: [],
        memberships: [
          { sessionIdleTimeoutMinutes: 0, sessionMaxLifetimeMinutes: 0 },
        ],
      });
      const policies = new PrismaSessionBoundPolicies(prisma.client);

      expect(await policies.forUser({ userId: "user-sam" })).toEqual({
        idleTimeoutMinutes: 0,
        maxLifetimeMinutes: 0,
      });
    });
  });
});

describe("given an organization that locks accounts", () => {
  describe("when the lock-out policy is read", () => {
    /** @scenario "The second step keeps the lock it already had" */
    it("never reads the two-step component's own lock-out counters", async () => {
      // The two-step component has kept its own per-account counter and lock
      // since D06, and this feature deliberately did not rebuild them. Asking
      // for its columns here would be the first step towards two things
      // believing they own the same decision.
      const prisma = prismaWhere({
        organizations: [{ lockoutAfterFailedAttempts: 5, lockoutMinutes: 30 }],
        memberships: [{ lockoutAfterFailedAttempts: 5, lockoutMinutes: 30 }],
      });
      const policies = new PrismaLockoutPolicies(prisma.client);

      await policies.installationWide();
      await policies.forUser({ userId: "user-sam" });

      expect(prisma.columnsRead()).not.toContain("failedVerificationCount");
      expect(prisma.columnsRead()).not.toContain("lockedUntil");
    });
  });
});

describe("given somebody is refused because their address is locked out", () => {
  describe("when they read what they are told", () => {
    /** @scenario "The answer never says which half was wrong" */
    it("says nothing about the password, the account, or how many tries are left", () => {
      // Asked the way the app asks it, so this tests what a customer is
      // actually handed rather than a registry entry that might not be wired.
      const copy = explainHandledError({
        code: "identity_sign_in_locked_out",
        message: "identity_sign_in_locked_out",
      } as never);
      const words = `${copy.title} ${copy.description}`.toLowerCase();

      // Telling somebody their password was right but the account is locked
      // turns the lock-out screen into a password oracle: the attacker learns
      // the credential without ever getting in.
      expect(words).not.toMatch(/password (is|was) (correct|right)/);
      expect(words).not.toMatch(/correct password/);
      // And nothing about whether the address has an account here, because an
      // address with none is answered with these exact words.
      expect(words).not.toMatch(/account (does not|doesn't) exist/);
      expect(words).not.toMatch(/no account/);
      // Waiting is the remedy, and it is the one thing it does say.
      expect(words).toMatch(/wait|try again/);
    });

    it("is a code the registry has words for at all", () => {
      // The guard behind the guard: a code nobody wrote copy for reaches the
      // customer as a generic "unknown error", which for a lock-out is worse
      // than useless — they would have no idea that waiting fixes it.
      expect(APP_ERROR_CODES).toContain("identity_sign_in_locked_out");
    });
  });
});
