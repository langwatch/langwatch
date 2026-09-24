/**
 * @vitest-environment node
 *
 * The staff lookup asks which organizations a person is in, through the real
 * org-tenancy guard.
 *
 * SAME CLASS AS DEFECTS 2 AND 3, and the last surviving one. `OrganizationUser`
 * keyed only by `userId` spans every organization at once, so the guard
 * (ADR-021) refuses it — with a plain `Error`, which is the dangerous part,
 * because callers that catch broadly turn the refusal into "no rows" rather
 * than into a failure anybody sees. The same shape has already been a 401 for
 * every user on the installation and a 500 on every authenticated page load.
 *
 * The question this read asks genuinely crosses organizations, so there is no
 * scope to add: it has to be asked of `Organization`, which the guard governs
 * by relation. The assertion is therefore not "the where clause looks right" —
 * it runs the repository against a Prisma stand-in that applies the real guard
 * to every call, and the regression is the throw itself.
 */
import { describe, expect, it } from "vitest";
import type { GuardParams } from "~/utils/dbGuardMiddleware";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import { PrismaIdentityLookupRepository } from "../identity-lookup.prisma.repository";

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

describe("given an operator looking a person up across organizations", () => {
  describe("when their memberships are read", () => {
    it("asks a question the tenancy guard allows, rather than throwing", async () => {
      const { prisma, asked } = guardedPrisma({
        organizations: [
          {
            id: "org_acme",
            name: "Acme",
            members: [{ userId: "user_ada", role: "ADMIN" }],
          },
          {
            id: "org_globex",
            name: "Globex",
            members: [{ userId: "user_ada", role: "MEMBER" }],
          },
        ],
      });

      const rows = await new PrismaIdentityLookupRepository(
        prisma,
      ).findMemberships({ userIds: ["user_ada"] });

      expect(rows).toEqual([
        {
          userId: "user_ada",
          organizationId: "org_acme",
          organizationName: "Acme",
          role: "ADMIN",
        },
        {
          userId: "user_ada",
          organizationId: "org_globex",
          organizationName: "Globex",
          role: "MEMBER",
        },
      ]);
      // It got there by asking the organizations, filtered by membership —
      // never `OrganizationUser` on its own.
      expect(asked.map((call) => call.model)).toEqual(["Organization"]);
    });

    it("asks for memberships without excluding the disabled ones", async () => {
      // An operator looking somebody up has to see the organizations they
      // were removed from, and this read is not the one that decides access.
      //
      // ASSERTED ON THE PREDICATE, NOT ON THE ROWS. The stand-in returns
      // whatever it is handed and never applies a nested `where`, so counting
      // rows back would pass just as happily against a query that filtered
      // disabled memberships out. What the guard saw is the only evidence
      // here that no such filter was sent.
      const { prisma, asked } = guardedPrisma({ organizations: [] });

      await new PrismaIdentityLookupRepository(prisma).findMemberships({
        userIds: ["user_ada"],
      });

      const [call] = asked;
      const args = call?.args as {
        where?: { members?: { some?: Record<string, unknown> } };
        select?: { members?: { where?: Record<string, unknown> } };
      };
      expect(args.where?.members?.some).toEqual({
        userId: { in: ["user_ada"] },
      });
      expect(args.where?.members?.some).not.toHaveProperty("disabledAt");
      expect(args.select?.members?.where).not.toHaveProperty("disabledAt");
    });

    it("asks nothing at all for an empty list", async () => {
      const { prisma, asked } = guardedPrisma({ organizations: [] });

      const rows = await new PrismaIdentityLookupRepository(
        prisma,
      ).findMemberships({ userIds: [] });

      expect(rows).toEqual([]);
      expect(asked).toEqual([]);
    });
  });
});

describe("given the shape this replaced", () => {
  it("is still refused by the guard, so the regression has teeth", async () => {
    // If this ever stops throwing, the guard stopped enforcing and the
    // assertion above stopped meaning anything.
    await expect(
      guardOrganizationId(
        {
          model: "OrganizationUser",
          action: "findMany",
          args: { where: { userId: { in: ["user_ada"] } } },
        } as GuardParams,
        async () => [],
      ),
    ).rejects.toThrow();
  });
});
