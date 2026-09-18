import { permissionSatisfiedBy } from "@langwatch/authz";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import {
  hasProjectPermission,
  type Permission,
} from "~/server/app-layer/authz/permission-adapters";

// Custom-role JSON is intentionally tested as arbitrary strings; the
// canonical matcher owns manage-to-action hierarchy semantics.
const hasPermissionWithHierarchy = (
  permissions: readonly string[] | null | undefined,
  requestedPermission: string,
): boolean =>
  permissionSatisfiedBy({
    granted: new Set(permissions ?? []),
    requested: requestedPermission,
  });

// Default project mock — returns team+org info in the shape resolveProjectPermission expects
const mockProjectResult = {
  team: {
    id: "team-123",
    organizationId: "org-123",
  },
};

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
  role: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  groupMembership: {
    findMany: vi.fn(),
  },
  grant: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
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
    // Default setup for every test: project returns team info, the caller is a
    // current org member (resolveProjectPermission fails closed otherwise), and
    // there are no group memberships.
    mockPrisma.project.findUnique.mockResolvedValue(mockProjectResult);
    mockPrisma.organizationUser.findFirst.mockResolvedValue({
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
    });
    mockPrisma.groupMembership.findMany.mockResolvedValue([]);
  });

  describe("Custom Role Permission Inheritance", () => {
    it("allows custom role with manage permission to access view permission", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["workflows:manage"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true);
    });

    it("allows custom role with manage permission to access create permission", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["workflows:manage"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:create" as Permission,
      );

      expect(result).toBe(true);
    });

    it("allows custom role with manage permission to access update permission", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["workflows:manage"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:update" as Permission,
      );

      expect(result).toBe(true);
    });

    it("allows custom role with manage permission to access delete permission", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["workflows:manage"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:delete" as Permission,
      );

      expect(result).toBe(true);
    });

    it("does not allow custom role with only view permission to access manage permission", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["workflows:view"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:manage" as Permission,
      );

      expect(result).toBe(false);
    });
  });

  describe("Complex Custom Role Scenarios", () => {
    it("handles custom role with mixed permissions correctly", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: [
            "workflows:manage",
            "datasets:view",
            "analytics:manage",
            "traces:share",
            "traces:view",
          ],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

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

    it("denies a custom role with no permissions", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: [], // No permissions — falls back to built-in role,
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      // An empty custom role is authoritative and fails closed in the
      // canonical grants engine; it does not regain the viewer bag.
      expect(result).toBe(false);
    });

    it("handles custom role with invalid permission format", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: ["invalid-permission", "workflows:view"],
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

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
    it("handles null custom role gracefully", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "admin",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true);
    });

    it("denies a custom role with null permissions", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "custom:custom-role-123",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([
        {
          id: "custom-role-123",
          organizationId: "org-123",
          name: "Custom role",
          description: null,
          kind: "custom",
          permissions: null,
          deletedAt: null,
          occurredAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      // Malformed custom-role payloads are parsed as an empty permission set.
      expect(result).toBe(false);
    });

    it("handles team with null default custom role", async () => {
      mockPrisma.grant.findMany.mockResolvedValue([
        {
          id: "grant-123",
          organizationId: "org-123",
          principalType: "USER",
          principalId: "user-123",
          roleKey: "viewer",
          scopeType: "PROJECT",
          scopeId: "project-123",
          revokedAt: null,
          source: "grants-service",
          occurredAt: new Date(0),
        },
      ]);
      mockPrisma.role.findMany.mockResolvedValue([]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );

      expect(result).toBe(true); // Falls back to built-in role
    });

    describe("permission hierarchy with custom roles", () => {
      const customPermissions = [
        "workflows:manage",
        "datasets:view",
        "analytics:create",
        "traces:share",
      ];

      const testCases: Array<{
        permission: string;
        expected: boolean;
        reason: string;
      }> = [
        {
          permission: "workflows:view",
          expected: true,
          reason: "manage includes view",
        },
        {
          permission: "workflows:create",
          expected: true,
          reason: "manage includes create",
        },
        {
          permission: "workflows:update",
          expected: true,
          reason: "manage includes update",
        },
        {
          permission: "workflows:delete",
          expected: true,
          reason: "manage includes delete",
        },
        {
          permission: "workflows:manage",
          expected: true,
          reason: "direct match",
        },
        {
          permission: "datasets:view",
          expected: true,
          reason: "direct match",
        },
        {
          permission: "datasets:create",
          expected: false,
          reason: "only has view, not create",
        },
        {
          permission: "datasets:manage",
          expected: false,
          reason: "only has view, not manage",
        },
        {
          permission: "analytics:view",
          expected: false,
          reason: "has create but not view",
        },
        {
          permission: "analytics:create",
          expected: true,
          reason: "direct match",
        },
        {
          permission: "analytics:manage",
          expected: false,
          reason: "only has create, not manage",
        },
        {
          permission: "traces:view",
          expected: false,
          reason: "only has share, not view",
        },
        {
          permission: "traces:share",
          expected: true,
          reason: "direct match",
        },
      ];

      testCases.forEach(({ permission, expected, reason }) => {
        it(`${
          expected ? "allows" : "denies"
        } ${permission} (${reason})`, () => {
          expect(
            hasPermissionWithHierarchy(customPermissions, permission),
          ).toBe(expected);
        });
      });
    });

    describe("case sensitivity in custom role permissions", () => {
      const customPermissions = ["Experiments:Manage", "DATASETS:VIEW"];

      const testCases: Array<{
        permission: string;
        expected: boolean;
        reason: string;
      }> = [
        {
          permission: "workflows:manage",
          expected: false,
          reason: "permission not granted",
        },
        {
          permission: "datasets:view",
          expected: false,
          reason: "case mismatch (lowercase vs UPPERCASE)",
        },
        {
          permission: "Experiments:Manage",
          expected: true,
          reason: "exact case match",
        },
        {
          permission: "DATASETS:VIEW",
          expected: true,
          reason: "exact case match",
        },
      ];

      testCases.forEach(({ permission, expected, reason }) => {
        it(`${
          expected ? "allows" : "denies"
        } ${permission} (${reason})`, () => {
          expect(
            hasPermissionWithHierarchy(customPermissions, permission),
          ).toBe(expected);
        });
      });
    });

    describe("malformed permission strings in custom roles", () => {
      const customPermissions = [
        "workflows:manage",
        "invalid-permission",
        ":view",
        "workflows:",
        "workflows",
      ];

      const testCases: Array<{
        permission: string;
        expected: boolean;
        reason: string;
      }> = [
        {
          permission: "workflows:view",
          expected: true,
          reason: "manage includes view",
        },
        {
          permission: "workflows:manage",
          expected: true,
          reason: "direct match",
        },
        {
          permission: "invalid-permission",
          expected: true,
          reason: "direct match (malformed but present)",
        },
        {
          permission: ":view",
          expected: true,
          reason: "direct match (malformed but present)",
        },
        {
          permission: "workflows:",
          expected: true,
          reason: "direct match (malformed but present)",
        },
        {
          permission: "workflows",
          expected: true,
          reason: "direct match (malformed but present)",
        },
      ];

      testCases.forEach(({ permission, expected, reason }) => {
        it(`${
          expected ? "allows" : "denies"
        } ${permission} (${reason})`, () => {
          expect(
            hasPermissionWithHierarchy(customPermissions, permission),
          ).toBe(expected);
        });
      });
    });
  });

  describe("Custom Role Validation", () => {
    it("validates permission format in custom roles", () => {
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

    it("handles empty permission arrays", () => {
      const emptyPermissions: string[] = [];

      expect(
        hasPermissionWithHierarchy(emptyPermissions, "workflows:view"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(emptyPermissions, "workflows:manage"),
      ).toBe(false);
    });

    it("handles undefined permission arrays", () => {
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
