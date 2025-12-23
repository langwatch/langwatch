import { TeamUserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleService } from "../../role";
import {
  RoleDuplicateNameError,
  RoleInUseError,
  RoleNotFoundError,
  TeamNotFoundError,
  UserNotTeamMemberError,
} from "../../role/errors";

// Mock Prisma client
const mockPrisma = {
  customRole: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  team: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  teamUser: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  organizationUser: {
    findFirst: vi.fn(),
  },
} as any;

describe("RoleService Tests", () => {
  let roleService: RoleService;

  beforeEach(() => {
    vi.clearAllMocks();
    roleService = new RoleService(mockPrisma);
  });

  describe("getAllRoles", () => {
    it("should return all custom roles for organization", async () => {
      const mockRoles = [
        {
          id: "role-1",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: "org-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "role-2",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: "org-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.customRole.findMany.mockResolvedValue(mockRoles);

      const result = await roleService.getAllRoles("org-123");

      expect(result).toEqual([
        {
          id: "role-1",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        {
          id: "role-2",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: "org-123",
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      ]);
      expect(mockPrisma.customRole.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-123" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("getRoleById", () => {
    it("should return role by ID", async () => {
      const mockRole = {
        id: "role-1",
        name: "Data Analyst",
        description: "Can view analytics and datasets",
        permissions: ["analytics:view", "datasets:view"],
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRole);

      const result = await roleService.getRoleById("role-1");

      expect(result).toEqual({
        ...mockRole,
        permissions: ["analytics:view", "datasets:view"],
      });
    });

    it("should throw NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(roleService.getRoleById("nonexistent-role")).rejects.toThrow(
        RoleNotFoundError,
      );
      await expect(roleService.getRoleById("nonexistent-role")).rejects.toThrow(
        "Role not found",
      );
    });
  });

  describe("createRole", () => {
    it("should create new custom role", async () => {
      const mockRole = {
        id: "role-1",
        name: "Data Analyst",
        description: "Can view analytics and datasets",
        permissions: ["analytics:view", "datasets:view"],
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(null);
      mockPrisma.customRole.create.mockResolvedValue(mockRole);

      const result = await roleService.createRole({
        organizationId: "org-123",
        name: "Data Analyst",
        description: "Can view analytics and datasets",
        permissions: ["analytics:view", "datasets:view"],
      });

      expect(result).toEqual({
        ...mockRole,
        permissions: ["analytics:view", "datasets:view"],
      });
      expect(mockPrisma.customRole.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org-123",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
        },
      });
    });

    it("should throw CONFLICT when role with same name exists", async () => {
      const existingRole = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(existingRole);

      await expect(
        roleService.createRole({
          organizationId: "org-123",
          name: "Data Analyst",
          permissions: ["analytics:view"],
        }),
      ).rejects.toThrow(RoleDuplicateNameError);
      await expect(
        roleService.createRole({
          organizationId: "org-123",
          name: "Data Analyst",
          permissions: ["analytics:view"],
        }),
      ).rejects.toThrow("A role with this name already exists");
    });
  });

  describe("updateRole", () => {
    it("should update custom role", async () => {
      const existingRole = {
        id: "role-1",
        name: "Data Analyst",
        description: "Old description",
        permissions: ["analytics:view"],
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedRole = {
        ...existingRole,
        name: "Senior Data Analyst",
        description: "Updated description",
        permissions: ["analytics:view", "analytics:manage"],
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(existingRole);
      mockPrisma.customRole.update.mockResolvedValue(updatedRole);

      const result = await roleService.updateRole("role-1", {
        name: "Senior Data Analyst",
        description: "Updated description",
        permissions: ["analytics:view", "analytics:manage"],
      });

      expect(result).toEqual({
        ...updatedRole,
        permissions: ["analytics:view", "analytics:manage"],
      });
    });

    it("should throw NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(
        roleService.updateRole("nonexistent-role", {
          name: "Updated Role",
        }),
      ).rejects.toThrow("Role not found");
    });
  });

  describe("deleteRole", () => {
    it("should delete custom role when not assigned to users", async () => {
      const mockRoleWithUsers = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignedUsers: [],
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRoleWithUsers);

      const result = await roleService.deleteRole("role-1");

      expect(result).toEqual({ success: true });
      expect(mockPrisma.customRole.delete).toHaveBeenCalledWith({
        where: { id: "role-1" },
      });
    });

    it("should throw NOT_FOUND when role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(roleService.deleteRole("nonexistent-role")).rejects.toThrow(
        "Role not found",
      );
    });

    it("should throw PRECONDITION_FAILED when role is assigned to users", async () => {
      const mockRoleWithUsers = {
        id: "role-1",
        name: "Data Analyst",
        organizationId: "org-123",
        createdAt: new Date(),
        updatedAt: new Date(),
        assignedUsers: [{ id: "user-1" }, { id: "user-2" }],
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockRoleWithUsers);

      await expect(roleService.deleteRole("role-1")).rejects.toThrow(
        RoleInUseError,
      );
      await expect(roleService.deleteRole("role-1")).rejects.toThrow(
        "Cannot delete role that is assigned to 2 user(s)",
      );
    });
  });

  describe("assignRoleToUser", () => {
    it("should assign custom role to user", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
      };

      const mockTeam = {
        id: "team-123",
        organizationId: "org-123",
      };

      const mockTeamUser = {
        userId: "user-123",
        teamId: "team-123",
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.teamUser.findUnique.mockResolvedValue(mockTeamUser);

      const result = await roleService.assignRoleToUser(
        "user-123",
        "team-123",
        "role-123",
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.teamUser.update).toHaveBeenCalledWith({
        where: {
          userId_teamId: {
            userId: "user-123",
            teamId: "team-123",
          },
        },
        data: {
          role: TeamUserRole.CUSTOM,
          assignedRoleId: "role-123",
        },
      });
    });

    it("should throw NOT_FOUND when custom role does not exist", async () => {
      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser(
          "user-123",
          "team-123",
          "nonexistent-role",
        ),
      ).rejects.toThrow(RoleNotFoundError);
      await expect(
        roleService.assignRoleToUser(
          "user-123",
          "team-123",
          "nonexistent-role",
        ),
      ).rejects.toThrow("Custom role not found");
    });

    it("should throw NOT_FOUND when team does not exist", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser("user-123", "team-123", "role-123"),
      ).rejects.toThrow(TeamNotFoundError);
      await expect(
        roleService.assignRoleToUser("user-123", "team-123", "role-123"),
      ).rejects.toThrow("Team not found");
    });

    it("should throw FORBIDDEN when user is not a team member", async () => {
      const mockCustomRole = {
        id: "role-123",
        organizationId: "org-123",
      };

      const mockTeam = {
        id: "team-123",
        organizationId: "org-123",
      };

      mockPrisma.customRole.findUnique.mockResolvedValue(mockCustomRole);
      mockPrisma.team.findUnique.mockResolvedValue(mockTeam);
      mockPrisma.teamUser.findUnique.mockResolvedValue(null);

      await expect(
        roleService.assignRoleToUser("user-123", "team-123", "role-123"),
      ).rejects.toThrow(UserNotTeamMemberError);
      await expect(
        roleService.assignRoleToUser("user-123", "team-123", "role-123"),
      ).rejects.toThrow("User is not a member of the specified team");
    });
  });

  describe("removeRoleFromUser", () => {
    it("should remove custom role from user", async () => {
      const result = await roleService.removeRoleFromUser(
        "user-123",
        "team-123",
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.teamUser.update).toHaveBeenCalledWith({
        where: {
          userId_teamId: {
            userId: "user-123",
            teamId: "team-123",
          },
        },
        data: {
          role: TeamUserRole.VIEWER,
          assignedRoleId: null,
        },
      });
    });
  });
});
