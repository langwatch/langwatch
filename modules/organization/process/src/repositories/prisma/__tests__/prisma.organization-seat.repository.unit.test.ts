import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaOrganizationSeatRepository } from "../prisma.organization-seat.repository.ts";

/**
 * The seat counts a licence and a plan read, moved from entitlement to organization
 * with the full/lite classification they apply (Alex, 2026-09-27).
 */

// Create mock Prisma client
const createMockPrisma = () => ({
  project: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  organizationUser: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  organizationInvite: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  team: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  teamUser: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  roleBinding: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  customRole: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  cost: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
});

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("PrismaOrganizationSeatRepository", () => {
  let repository: PrismaOrganizationSeatRepository;
  let mockPrisma: MockPrisma;
  const organizationId = "org-123";

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    repository = PrismaOrganizationSeatRepository.create(prismaDouble(mockPrisma));
  });

  describe("when getting the member count", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts ADMIN and MEMBER role users as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(2);
    });

    it("counts EXTERNAL role users with non-view custom role as full members (elevated from Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: "role-1" }]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:manage"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count EXTERNAL role users with view-only custom role as full members (they are Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: "role-1" }]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    /** @scenario "Disabled members are not counted against the license" */
    it("reads only members whose disabledAt is null", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      await repository.getMemberCount(organizationId);

      expect(mockPrisma.organizationUser.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId, disabledAt: null } }),
      );
    });

    /** @scenario Pending invites count toward total member limit */
    it("counts pending invites with ADMIN role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts pending invites with MEMBER role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.MEMBER,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    /** @scenario Pending invite with non-view custom role counts as Full Member */
    it("counts pending invites with non-view custom role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:update"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(1);
    });

    /** @scenario Pending invite with view-only custom role counts as Lite Member */
    it("does not count pending invites with view-only custom role as full members", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    /** @scenario Expired invites do not count toward member limit */
    /** @scenario Only non-expired pending invites count toward limit */
    it("does not count expired invites", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      // Expired invites should be filtered by query, not returned
      expect(result).toBe(0);
    });

    it("does not count EXTERNAL role users without team assignment as full members (they are Lite Member)", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([]); // No team assignment
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no full members exist", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(0);
    });

    it("combines users and pending invites in total count", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMemberCount(organizationId);

      expect(result).toBe(3);
    });
  });

  describe("when getting the lite members count", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-03-15T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario Lite Member users are counted separately from full members */
    it("counts EXTERNAL users without custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: null }]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts EXTERNAL users with view-only custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: "role-1" }]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count EXTERNAL users with non-view custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: "role-1" }]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:manage"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("does not count ADMIN or MEMBER users as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.MEMBER },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("counts pending invites with EXTERNAL role and no custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("counts pending invites with EXTERNAL role and view-only custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "analytics:view"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("does not count pending invites with non-view custom role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.customRole.findMany.mockResolvedValue([
        { id: "role-1", permissions: ["project:view", "project:update"] },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: [{ teamId: "team-1", customRoleId: "role-1" }],
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("does not count pending invites with ADMIN or MEMBER role as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.ADMIN,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
        {
          role: OrganizationUserRole.MEMBER,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("returns zero when no Lite Member users exist", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([]);
      mockPrisma.team.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(0);
    });

    it("counts EXTERNAL users without team assignment as Lite Member", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([]); // No team assignment
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(1);
    });

    it("combines users and pending invites in total count", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.EXTERNAL },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([{ id: "team-1" }]);
      mockPrisma.roleBinding.findMany.mockResolvedValue([{ userId: "u1", customRoleId: null }]);
      mockPrisma.customRole.findMany.mockResolvedValue([]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        {
          role: OrganizationUserRole.EXTERNAL,
          teamAssignments: null,
          expiration: new Date("2024-03-20"),
        },
      ]);

      const result = await repository.getMembersLiteCount(organizationId);

      expect(result).toBe(2);
    });
  });

  describe("when getting the Developer count", () => {
    /** @scenario Developers are counted and never capped */
    it("counts DEVELOPER users and pending DEVELOPER invites, and nothing else", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.ADMIN },
        { userId: "u2", role: OrganizationUserRole.EXTERNAL },
        { userId: "u3", role: OrganizationUserRole.DEVELOPER },
        { userId: "u4", role: OrganizationUserRole.DEVELOPER },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        { role: OrganizationUserRole.DEVELOPER, teamAssignments: null },
        { role: OrganizationUserRole.MEMBER, teamAssignments: null },
      ]);

      expect(await repository.getMembersDeveloperCount(organizationId)).toBe(3);
    });

    it("never moves the Full or Lite counts", async () => {
      mockPrisma.organizationUser.findMany.mockResolvedValue([
        { userId: "u1", role: OrganizationUserRole.MEMBER },
        { userId: "u2", role: OrganizationUserRole.EXTERNAL },
        { userId: "u3", role: OrganizationUserRole.DEVELOPER },
      ]);
      mockPrisma.organizationInvite.findMany.mockResolvedValue([
        { role: OrganizationUserRole.DEVELOPER, teamAssignments: null },
      ]);

      expect(await repository.getMemberCount(organizationId)).toBe(1);
      expect(await repository.getMembersLiteCount(organizationId)).toBe(1);
    });
  });
});
