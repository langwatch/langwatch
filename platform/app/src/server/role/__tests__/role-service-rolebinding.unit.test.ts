import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { UserNotTeamMemberError } from "../errors";
import { RoleService } from "../role.service";

// A team role assignment is a ledger command since ADR-092 delivery-plan PR 2.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ authzGrants: ledger }),
  tryGetApp: () => null,
}));

const mockPrisma = {
  team: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    // The personal-team guard runs before the assignment; a shared team here.
    findFirst: vi.fn().mockResolvedValue(null),
  },
  roleBinding: {
    findFirst: vi.fn(),
  },
  customRole: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  // `isRootPrismaClient` discriminates on `$connect` (Prisma 7 transaction
  // clients carry `$transaction` too), so a root-client stand-in must have it.
  $connect: vi.fn(),
} as any;

describe("RoleService.assignRoleToUser", () => {
  let service: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RoleService(mockPrisma);
  });

  describe("when user has RoleBinding but no TeamUser row", () => {
    beforeEach(() => {
      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "role-1",
        organizationId: "org-1",
        kind: "custom",
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        organizationId: "org-1",
      });
      mockPrisma.roleBinding.findFirst.mockResolvedValue({
        userId: "user-rolebinding-only",
        role: TeamUserRole.MEMBER,
      });
      mockPrisma.team.findUniqueOrThrow.mockResolvedValue({
        organizationId: "org-1",
      });
    });

    it("allows role assignment via RoleBinding membership check", async () => {
      await expect(
        service.assignRoleToUser({
          userId: "user-rolebinding-only",
          teamId: "team-1",
          customRoleId: "role-1",
          actor: { type: "user" as const, id: "actor_1" },
        }),
      ).resolves.toEqual({ success: true });
    });

    it("queries roleBinding with team scope for membership", async () => {
      await service.assignRoleToUser({
        userId: "user-rolebinding-only",
        teamId: "team-1",
        customRoleId: "role-1",
        actor: { type: "user" as const, id: "actor_1" },
      });

      expect(mockPrisma.roleBinding.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-rolebinding-only",
          organizationId: "org-1",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
        },
      });
    });
  });

  describe("when user has no RoleBinding for the team", () => {
    beforeEach(() => {
      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "role-1",
        organizationId: "org-1",
        kind: "custom",
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        organizationId: "org-1",
      });
      mockPrisma.roleBinding.findFirst.mockResolvedValue(null);
    });

    it("throws UserNotTeamMemberError", async () => {
      await expect(
        service.assignRoleToUser({
          userId: "user-nobody",
          teamId: "team-1",
          customRoleId: "role-1",
          actor: { type: "user" as const, id: "actor_1" },
        }),
      ).rejects.toThrow(UserNotTeamMemberError);
    });
  });
});
