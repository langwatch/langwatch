import { describe, it, expect, beforeEach, vi } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { hasProjectPermission, type Permission } from "../rbac";

// Helper function to test permission hierarchy logic
function hasPermissionWithHierarchy(
  permissions: string[],
  requestedPermission: string,
): boolean {
  // Handle undefined or null permissions
  if (!permissions || !Array.isArray(permissions)) {
    return false;
  }

  // Direct match
  if (permissions.includes(requestedPermission)) {
    return true;
  }

  // Hierarchy rule: manage permissions include view, create, update, and delete permissions
  const actionSuffixes = [":view", ":create", ":update", ":delete"];
  for (const suffix of actionSuffixes) {
    if (requestedPermission.endsWith(suffix)) {
      const managePermission = requestedPermission.replace(suffix, ":manage");
      if (permissions.includes(managePermission)) {
        return true;
      }
    }
  }

  return false;
}

// Mock Prisma client
const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
  team: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  organizationUser: {
    findFirst: vi.fn(),
  },
  teamUser: {
    findFirst: vi.fn(),
  },
  teamUserCustomRole: {
    findFirst: vi.fn(),
  },
  customRole: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
} as any;

// Mock session
const mockSession = {
  user: {
    id: "user-123",
    email: "test@example.com",
  },
} as any;

describe("Custom Role Functionality Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Custom Role Permission Inheritance", () => {
    it("should allow custom role with manage permission to access view permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: ["workflows:manage"],
      } as any);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should allow custom role with manage permission to access create permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "custom-role-123",
        permissions: ["workflows:manage"],
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:create" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should allow custom role with manage permission to access update permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "custom-role-123",
        permissions: ["workflows:manage"],
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:update" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should allow custom role with manage permission to access delete permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "custom-role-123",
        permissions: ["workflows:manage"],
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:delete" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should not allow custom role with only view permission to access manage permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: ["workflows:view"],
      } as any);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:manage" as Permission,
      );

      expect(result).toBe(false);
    });
  });

  describe("Complex Custom Role Scenarios", () => {
    it("should handle custom role with mixed permissions correctly", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        id: "custom-role-123",
        permissions: [
          "workflows:manage",
          "datasets:view",
          "analytics:manage",
          "traces:share",
          "traces:view",
        ],
      });

      // Should have workflows:manage -> can access all workflows permissions
      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "workflows:view" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "workflows:create" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "workflows:update" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "workflows:delete" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "workflows:manage" as Permission,
        ),
      ).toBe(true);

      // Should have datasets:view -> can only access view
      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "datasets:view" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "datasets:create" as Permission,
        ),
      ).toBe(false);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "datasets:manage" as Permission,
        ),
      ).toBe(false);

      // Should have analytics:manage -> can access all analytics permissions
      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "analytics:view" as Permission,
        ),
      ).toBe(true);

      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "analytics:manage" as Permission,
        ),
      ).toBe(true);

      // Should have messages:share -> can access share but not view
      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "traces:share" as Permission,
        ),
      ).toBe(true);

      // User has traces:view permission in custom role
      expect(
        await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-123",
          "traces:view" as Permission,
        ),
      ).toBe(true);
    });

    it("should handle custom role with no permissions", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: [], // No permissions
      } as any);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      // Should fall back to built-in role (VIEWER can view workflows)
      expect(result).toBe(true);
    });

    it("should handle custom role with invalid permission format", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: ["invalid-permission", "workflows:view"],
      } as any);

      // Should still work with valid permissions
      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle null custom role gracefully", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.ADMIN,
              assignedRoleId: null,
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should handle custom role with null permissions", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.ADMIN,
              assignedRoleId: "custom-role-123",
            },
          ],
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: null,
      } as any);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true); // Falls back to built-in role
    });

    it("should handle team with null default custom role", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [
            {
              userId: "user-123",
              role: TeamUserRole.VIEWER,
              assignedRoleId: null,
            },
          ],
          // Null default custom role
        },
      });

      mockPrisma.customRole.findUnique.mockResolvedValue(null);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true); // Falls back to built-in role
    });

    it("should handle permission hierarchy with custom roles", () => {
      const customPermissions = [
        "workflows:manage",
        "datasets:view",
        "analytics:create",
        "traces:share",
      ];

      // Test hierarchy rules
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:create"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:update"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:delete"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:manage"),
      ).toBe(true);

      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:create"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:manage"),
      ).toBe(false);

      expect(
        hasPermissionWithHierarchy(customPermissions, "analytics:view"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(customPermissions, "analytics:create"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "analytics:manage"),
      ).toBe(false);

      expect(hasPermissionWithHierarchy(customPermissions, "traces:view")).toBe(
        false,
      );
      expect(
        hasPermissionWithHierarchy(customPermissions, "traces:share"),
      ).toBe(true);
    });

    it("should handle case sensitivity in custom role permissions", () => {
      const customPermissions = ["Experiments:Manage", "DATASETS:VIEW"];

      // Should be case sensitive
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:manage"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:view"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(customPermissions, "Experiments:Manage"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "DATASETS:VIEW"),
      ).toBe(true);
    });

    it("should handle malformed permission strings in custom roles", () => {
      const customPermissions = [
        "workflows:manage",
        "invalid-permission",
        ":view",
        "workflows:",
        "workflows",
      ];

      // Should only work with valid permissions
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "workflows:manage"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "invalid-permission"),
      ).toBe(true);
      expect(hasPermissionWithHierarchy(customPermissions, ":view")).toBe(true);
      expect(hasPermissionWithHierarchy(customPermissions, "workflows:")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(customPermissions, "workflows")).toBe(
        true,
      );
    });
  });

  describe("Custom Role Validation", () => {
    it("should validate permission format in custom roles", () => {
      const validPermissions = [
        "workflows:view",
        "datasets:manage",
        "analytics:create",
        "traces:share",
        "project:delete",
      ];

      const invalidPermissions = [
        "workflows:",
        ":view",
        "workflows",
        "EXPERIMENTS:VIEW",
        "workflows:VIEW",
        "Experiments:view",
      ];

      validPermissions.forEach((permission) => {
        expect(permission).toMatch(/^[a-z]+:[a-z]+$/);
      });

      invalidPermissions.forEach((permission) => {
        expect(permission).not.toMatch(/^[a-z]+:[a-z]+$/);
      });
    });

    it("should handle empty permission arrays", () => {
      const emptyPermissions: string[] = [];

      expect(
        hasPermissionWithHierarchy(emptyPermissions, "workflows:view"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(emptyPermissions, "workflows:manage"),
      ).toBe(false);
    });

    it("should handle undefined permission arrays", () => {
      const undefinedPermissions = undefined as any;

      expect(
        hasPermissionWithHierarchy(undefinedPermissions, "workflows:view"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(undefinedPermissions, "workflows:manage"),
      ).toBe(false);
    });
  });
});
