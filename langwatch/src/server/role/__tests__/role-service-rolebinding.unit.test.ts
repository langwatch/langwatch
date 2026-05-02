import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleService } from "../role.service";
import { UserNotTeamMemberError } from "../errors";

const mockTx = {
  roleBinding: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

const mockPrisma = {
  team: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
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
  $transaction: vi.fn((cb: (tx: any) => Promise<any>) => cb(mockTx)),
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
        service.assignRoleToUser("user-rolebinding-only", "team-1", "role-1")
      ).resolves.toEqual({ success: true });
    });

    it("queries roleBinding with team scope for membership", async () => {
      await service.assignRoleToUser(
        "user-rolebinding-only",
        "team-1",
        "role-1"
      );

      expect(mockPrisma.roleBinding.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user-rolebinding-only",
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
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        organizationId: "org-1",
      });
      mockPrisma.roleBinding.findFirst.mockResolvedValue(null);
    });

    it("throws UserNotTeamMemberError", async () => {
      await expect(
        service.assignRoleToUser("user-nobody", "team-1", "role-1")
      ).rejects.toThrow(UserNotTeamMemberError);
    });
  });
});
