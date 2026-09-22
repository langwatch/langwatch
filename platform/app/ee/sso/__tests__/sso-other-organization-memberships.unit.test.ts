import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import { findOtherOrganizationIds } from "../sso-other-organization-memberships.prisma";

/**
 * A client on a dead connection whose `OrganizationUser` reads run the real
 * tenancy guard first, the way the application's client does. Any lookup the
 * guard refuses throws here exactly as it throws in production.
 */
function fixture() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://test:test@127.0.0.1:1/test",
    }),
  });
  const organizationUserFindMany = vi
    .spyOn(prisma.organizationUser, "findMany")
    .mockImplementation(
      (args) =>
        guardOrganizationId(
          { model: "OrganizationUser", action: "findMany", args },
          async () => [],
        ) as never,
    );
  const userFindMany = vi.spyOn(prisma.user, "findMany");
  return { prisma, organizationUserFindMany, userFindMany };
}

describe("given members whose identities may be shared with another organization", () => {
  describe("when the other organizations are looked up through the members", () => {
    it("returns each other organization once and never reads OrganizationUser unbounded", async () => {
      const { prisma, organizationUserFindMany, userFindMany } = fixture();
      userFindMany.mockResolvedValueOnce([
        { orgMemberships: [{ organizationId: "org_other" }] },
        {
          orgMemberships: [
            { organizationId: "org_other" },
            { organizationId: "org_third" },
          ],
        },
      ] as never);

      await expect(
        findOtherOrganizationIds({
          prisma,
          organizationId: "org_acme",
          userIds: ["user_a", "user_b"],
        }),
      ).resolves.toEqual(["org_other", "org_third"]);

      expect(userFindMany).toHaveBeenCalledExactlyOnceWith({
        where: { id: { in: ["user_a", "user_b"] } },
        select: {
          orgMemberships: {
            where: { organizationId: { not: "org_acme" } },
            select: { organizationId: true },
          },
        },
      });
      expect(organizationUserFindMany).not.toHaveBeenCalled();
    });

    it("asks nothing when there are no members to look up", async () => {
      const { prisma, userFindMany } = fixture();

      await expect(
        findOtherOrganizationIds({
          prisma,
          organizationId: "org_acme",
          userIds: [],
        }),
      ).resolves.toEqual([]);

      expect(userFindMany).not.toHaveBeenCalled();
    });
  });

  describe("when the same question is asked of OrganizationUser directly", () => {
    // @scenario "Finishing is refused by the tenancy guard when a member's memberships are read across organizations"
    it("is refused by the tenancy guard, which is what finishing an update used to crash on", async () => {
      const { prisma } = fixture();

      await expect(
        prisma.organizationUser.findMany({
          where: {
            userId: { in: ["user_a"] },
            organizationId: { not: "org_acme" },
          },
          select: { organizationId: true },
        }),
      ).rejects.toThrow(/requires an 'organizationId'/);
    });
  });
});
