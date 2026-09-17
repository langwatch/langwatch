/**
 * @vitest-environment node
 *
 * The two reads that ask about a person rather than about an organization,
 * run through the real org-tenancy guard.
 *
 * WHY THIS SUITE EXISTS. `OrganizationUser` keyed only by `userId` spans
 * every organization at once, so the guard (ADR-021) refuses it — with a
 * plain `Error`, which is the dangerous part. It is thrown underneath
 * `getServerAuthSession`, whose catch returns a null session, so every
 * authenticated tRPC call on the installation answers UNAUTHORIZED while
 * `/api/auth/get-session` still answers 200: the browser believes it is
 * signed in and bounces between the application and the sign-in screen.
 *
 * It was dormant while every organization left these rules at zero, because
 * `installationWide()` finds nothing and the per-person read is never
 * reached. A new organization now starts with a one-day idle window, so the
 * first organization created after that default landed is enough to reach
 * it — which is exactly how it was found.
 *
 * So the assertion is not "the where clause has this shape". It runs the
 * adapter against a Prisma stand-in that applies `guardOrganizationId` to
 * every call, which is what the real client does, and the regression is the
 * throw itself.
 *
 * Specs: specs/identity/org-session-lifetime.feature,
 * specs/identity/org-account-lockout.feature
 */
import { describe, expect, it } from "vitest";
import type { GuardParams } from "~/utils/dbGuardMiddleware";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import {
  PrismaLockoutPolicies,
  PrismaSessionBoundPolicies,
} from "../sign-in-security-adapters";

/** Every call goes through the guard, the way the real client's does. */
function guardedPrisma({
  organizations = [] as Record<string, unknown>[],
}: {
  organizations?: Record<string, unknown>[];
}) {
  const asked: GuardParams[] = [];
  const through = async (params: GuardParams, rows: unknown) => {
    asked.push(params);
    return guardOrganizationId(params, async () => rows);
  };
  const prisma = {
    organization: {
      findMany: (args: unknown) =>
        through(
          { model: "Organization", action: "findMany", args },
          organizations,
        ),
    },
    organizationUser: {
      findMany: (args: unknown) =>
        through({ model: "OrganizationUser", action: "findMany", args }, []),
    },
  };
  return { prisma: prisma as never, asked };
}

describe("given a person whose organizations set a sign-in rule", () => {
  describe("when their own strictest rule is read", () => {
    it("asks a question the tenancy guard allows, rather than throwing under the session", async () => {
      const { prisma, asked } = guardedPrisma({
        organizations: [
          { sessionIdleTimeoutMinutes: 1440, sessionMaxLifetimeMinutes: 0 },
          { sessionIdleTimeoutMinutes: 60, sessionMaxLifetimeMinutes: 0 },
        ],
      });

      const bound = await new PrismaSessionBoundPolicies(prisma).forUser({
        userId: "user_ada",
      });

      // The strictest of the two, which is the whole point of the read.
      expect(bound.idleTimeoutMinutes).toBe(60);
      // And it got there by asking the organizations, filtered by
      // membership — never `OrganizationUser` on its own.
      expect(asked.map((call) => call.model)).toEqual(["Organization"]);
    });

    it("reads the lock-out rule the same guarded way", async () => {
      const { prisma, asked } = guardedPrisma({
        organizations: [
          { lockoutAfterFailedAttempts: 10, lockoutMinutes: 30 },
          { lockoutAfterFailedAttempts: 5, lockoutMinutes: 60 },
        ],
      });

      const policy = await new PrismaLockoutPolicies(prisma).forUser({
        userId: "user_ada",
      });

      expect(policy.afterFailedAttempts).toBe(5);
      expect(asked.map((call) => call.model)).toEqual(["Organization"]);
    });

    it("excludes a membership that has been disabled", async () => {
      const { prisma, asked } = guardedPrisma({ organizations: [] });

      await new PrismaSessionBoundPolicies(prisma).forUser({
        userId: "user_ada",
      });

      // A disabled member is not governed by the organization they were
      // removed from, so the predicate the guard saw says so.
      const [call] = asked;
      expect(call?.args).toMatchObject({
        where: { members: { some: { userId: "user_ada", disabledAt: null } } },
      });
    });
  });
});

describe("given the shape this replaced", () => {
  it("is still refused by the guard, so the regression has teeth", async () => {
    // If this ever stops throwing, the guard stopped enforcing and the
    // assertions above stopped meaning anything.
    await expect(
      guardOrganizationId(
        {
          model: "OrganizationUser",
          action: "findMany",
          args: { where: { userId: "user_ada" } },
        },
        async () => [],
      ),
    ).rejects.toThrow(/organizationId/i);
  });
});
