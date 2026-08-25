import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { PrismaAccessListingRepository } from "../access-listing.prisma.repository";

/**
 * The legacy reader's queries were moved verbatim from the services'
 * inline reads, and "byte-identical for a non-cut-over organization" is the
 * claim the whole seam rests on. The services' own copies are gone, so these
 * tests pin the moved WHERE / include / orderBy shapes directly — a drift
 * here is a behaviour change for every organization that has not cut over.
 *
 * The expected shapes are written out literally on purpose: importing the
 * module's own constants back would assert nothing.
 */

const PRINCIPAL_FENCE = {
  OR: [
    {
      userId: { not: null },
      user: { orgMemberships: { some: { organizationId: "org-1" } } },
    },
    { groupId: { not: null }, group: { organizationId: "org-1" } },
    { apiKeyId: { not: null }, apiKey: { organizationId: "org-1" } },
  ],
};

const DECORATION = {
  user: { select: { id: true, name: true, email: true, image: true } },
  group: { select: { id: true, name: true, scimSource: true } },
  apiKey: { select: { id: true, name: true } },
  customRole: { select: { id: true, name: true, permissions: true } },
};

const prismaWith = () => {
  const prisma = {
    roleBinding: { findMany: vi.fn().mockResolvedValue([]) },
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    prisma,
    repository: new PrismaAccessListingRepository(
      prisma as unknown as Prisma.TransactionClient,
    ),
  };
};

describe("PrismaAccessListingRepository", () => {
  describe("when one user's rows in one organization are listed", () => {
    it("keeps the original where, decoration include and ascending order", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findUserBindings({
        organizationId: "org-1",
        userId: "alice",
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", userId: "alice" },
        include: DECORATION,
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("when the whole organization's rows are listed", () => {
    it("carries the principal-membership fence the inline query carried", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findOrganizationBindings({ organizationId: "org-1" });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", ...PRINCIPAL_FENCE },
        include: DECORATION,
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("when a user's own and group-derived rows are listed together", () => {
    it("ORs the user with the group memberships", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findUserAndGroupBindings({
        organizationId: "org-1",
        userId: "alice",
        groupIds: ["group-1", "group-2"],
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          OR: [
            { userId: "alice" },
            { groupId: { in: ["group-1", "group-2"] } },
          ],
        },
        include: DECORATION,
        orderBy: { createdAt: "asc" },
      });
    });

    it("asks only for the user's own rows when there are no groups", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findUserAndGroupBindings({
        organizationId: "org-1",
        userId: "alice",
        groupIds: [],
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1", OR: [{ userId: "alice" }] },
        }),
      );
    });
  });

  describe("when one scope's rows are listed", () => {
    it("fences on the principal's membership and carries no ordering, like the team page's inline query", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findScopeBindings({
        organizationId: "org-1",
        scopeType: "TEAM",
        scopeIds: ["team-1"],
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scopeType: "TEAM",
          scopeId: { in: ["team-1"] },
          ...PRINCIPAL_FENCE,
        },
        include: DECORATION,
      });
    });

    it("answers an empty scope list without a query", async () => {
      const { prisma, repository } = prismaWith();

      const rows = await repository.findScopeBindings({
        organizationId: "org-1",
        scopeType: "PROJECT",
        scopeIds: [],
      });

      expect(rows).toEqual([]);
      expect(prisma.roleBinding.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when one group's rows are listed", () => {
    it("bounds the read to the organization", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findGroupBindings({
        organizationId: "org-1",
        groupId: "group-1",
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", groupId: "group-1" },
        include: DECORATION,
      });
    });
  });

  describe("when team member rows are listed for many teams", () => {
    it("keeps the membership fence and pre-seeds every requested team", async () => {
      const { prisma, repository } = prismaWith();

      const byTeam = await repository.findTeamMemberBindings({
        organizationId: "org-1",
        teamIds: ["team-1", "team-empty"],
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scopeType: "TEAM",
          scopeId: { in: ["team-1", "team-empty"] },
          userId: { not: null },
          user: { orgMemberships: { some: { organizationId: "org-1" } } },
        },
        include: { user: true, customRole: true },
      });
      expect([...byTeam.keys()].sort()).toEqual(["team-1", "team-empty"]);
      expect(byTeam.get("team-empty")).toEqual([]);
    });

    it("answers an empty team list without a query", async () => {
      const { prisma, repository } = prismaWith();

      const byTeam = await repository.findTeamMemberBindings({
        organizationId: "org-1",
        teamIds: [],
      });

      expect(byTeam.size).toBe(0);
      expect(prisma.roleBinding.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the synthesis read spans organizations", () => {
    it("keeps the original where and drops a group row tied to another organization", async () => {
      const { prisma, repository } = prismaWith();
      const row = {
        organizationId: "org-1",
        scopeType: "TEAM",
        scopeId: "team-1",
        role: "MEMBER",
        customRoleId: null,
        customRole: null,
      };
      prisma.roleBinding.findMany.mockResolvedValue([
        { ...row, group: null },
        { ...row, scopeId: "team-2", group: { organizationId: "org-1" } },
        { ...row, scopeId: "team-3", group: { organizationId: "org-other" } },
      ]);

      const rows = await repository.findBindingsForSynthesis({
        orgIds: ["org-1", "org-2"],
        userId: "alice",
      });

      expect(prisma.roleBinding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: { in: ["org-1", "org-2"] },
            OR: [
              { userId: "alice" },
              // `removedAt: null` is the fence: a group alice LEFT must not
              // synthesize its bindings onto her.
              {
                group: {
                  members: { some: { userId: "alice", removedAt: null } },
                },
              },
            ],
            scopeType: { in: ["TEAM", "ORGANIZATION", "PROJECT"] },
          },
        }),
      );
      expect(rows.map((r) => r.scopeId)).toEqual(["team-1", "team-2"]);
      expect(rows[0]).not.toHaveProperty("group");
    });

    it("answers an empty organization list without a query", async () => {
      const { prisma, repository } = prismaWith();

      const rows = await repository.findBindingsForSynthesis({
        orgIds: [],
        userId: "alice",
      });

      expect(rows).toEqual([]);
      expect(prisma.roleBinding.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the role editor's roles are listed", () => {
    it("keeps the user-created kind filter and newest-first order", async () => {
      const { prisma, repository } = prismaWith();

      await repository.findUserCreatedRoles({ organizationId: "org-1" });

      expect(prisma.customRole.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", kind: "custom" },
        orderBy: { createdAt: "desc" },
      });
    });
  });
});
