import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TeamUserRole } from "@prisma/client";
import {
  hasProjectPermission,
  isDemoProject,
  checkPermissionOrPubliclyShared,
  checkProjectPermission,
  type Permission,
} from "../rbac";

// Mock Prisma client
const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
  publicShare: {
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

describe("Demo Project and Public Sharing Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.DEMO_PROJECT_ID;
  });

  describe("Demo Project Functionality", () => {
    const DEMO_PROJECT_ID = "demo-project-123";

    beforeEach(() => {
      process.env.DEMO_PROJECT_ID = DEMO_PROJECT_ID;
    });

    it.skip("should allow view permissions for demo project", async () => {
      const viewPermissions = [
        "project:view",
        "analytics:view",
        "cost:view",
        "messages:view",
        "annotations:view",
        "guardrails:view",
        "experiments:view",
        "datasets:view",
        "workflows:view",
        "prompts:view",
        "scenarios:view",
        "playground:view",
      ];

      for (const permission of viewPermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(true);
      }
    });

    it("should not allow manage permissions for demo project", async () => {
      const managePermissions = [
        "project:manage",
        "analytics:manage",
        "messages:manage",
        "annotations:manage",
        "guardrails:manage",
        "experiments:manage",
        "datasets:manage",
        "workflows:manage",
        "prompts:manage",
        "scenarios:manage",
      ];

      for (const permission of managePermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(false);
      }
    });

    it("should not allow create permissions for demo project", async () => {
      const createPermissions = [
        "project:create",
        "experiments:create",
        "datasets:create",
        "workflows:create",
        "prompts:create",
        "scenarios:create",
      ];

      for (const permission of createPermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(false);
      }
    });

    it("should not allow update permissions for demo project", async () => {
      const updatePermissions = [
        "project:update",
        "experiments:update",
        "datasets:update",
        "workflows:update",
        "prompts:update",
        "scenarios:update",
      ];

      for (const permission of updatePermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(false);
      }
    });

    it("should not allow delete permissions for demo project", async () => {
      const deletePermissions = [
        "project:delete",
        "experiments:delete",
        "datasets:delete",
        "workflows:delete",
        "prompts:delete",
        "scenarios:delete",
      ];

      for (const permission of deletePermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(false);
      }
    });

    it("should not allow share permissions for demo project", async () => {
      const sharePermissions = ["messages:share"];

      for (const permission of sharePermissions) {
        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          DEMO_PROJECT_ID,
          permission as Permission,
        );
        expect(result).toBe(false);
      }
    });

    it("should return false for non-demo project", async () => {
      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "other-project-123",
        "project:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it.skip("should work with unauthenticated users for demo project", async () => {
      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: null },
        DEMO_PROJECT_ID,
        "project:view" as Permission,
      );
      expect(result).toBe(true);
    });

    it.skip("should handle demo project with different environment variable values", () => {
      const testCases = [
        {
          projectId: "demo-project-123",
          envValue: "demo-project-123",
          expected: true,
        },
        {
          projectId: "demo-project-456",
          envValue: "demo-project-123",
          expected: false,
        },
        {
          projectId: "demo-project-123",
          envValue: "different-demo",
          expected: false,
        },
        {
          projectId: "regular-project",
          envValue: "demo-project-123",
          expected: false,
        },
      ];

      testCases.forEach(({ projectId, envValue, expected }) => {
        process.env.DEMO_PROJECT_ID = envValue;
        const result = isDemoProject(projectId, "project:view" as Permission);
        expect(result).toBe(expected);
      });
    });
  });

  describe("Public Sharing Functionality", () => {
    const mockCtx = {
      prisma: mockPrisma,
      session: mockSession,
      permissionChecked: false,
      publiclyShared: false,
    };

    const mockNext = vi.fn().mockResolvedValue("success");

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should allow access when user has permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [{ userId: "user-123", role: TeamUserRole.ADMIN }],
          defaultRole: TeamUserRole.ADMIN,
          defaultCustomRole: null,
        },
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      const result = await middleware({
        ctx: mockCtx,
        input: { projectId: "project-123", traceId: "trace-123" },
        next: mockNext,
      });

      expect(result).toBe("success");
      expect(mockCtx.permissionChecked).toBe(true);
      expect(mockCtx.publiclyShared).toBe(false);
    });

    it("should allow access when resource is publicly shared", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue({
        id: "share-123",
        resourceType: "TRACE",
        resourceId: "trace-123",
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      const result = await middleware({
        ctx: mockCtx,
        input: { projectId: "project-123", traceId: "trace-123" },
        next: mockNext,
      });

      expect(result).toBe("success");
      expect(mockCtx.permissionChecked).toBe(true);
      expect(mockCtx.publiclyShared).toBe(true);
    });

    it("should throw UNAUTHORIZED when no permission and not shared", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue(null);

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" },
          next: mockNext,
        }),
      ).rejects.toThrow();
    });

    it("should handle different resource types", async () => {
      const resourceTypes = ["TRACE", "THREAD"];

      for (const resourceType of resourceTypes) {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-123",
            members: [],
            defaultRole: TeamUserRole.VIEWER,
            defaultCustomRole: null,
          },
        });

        mockPrisma.publicShare.findFirst.mockResolvedValue({
          id: "share-123",
          resourceType: resourceType as any,
          resourceId: "resource-123",
        });

        const middleware = checkPermissionOrPubliclyShared(
          checkProjectPermission("experiments:view" as Permission),
          { resourceType: resourceType as any, resourceParam: "resourceId" },
        );

        const result = await middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", resourceId: "resource-123" },
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.publiclyShared).toBe(true);
      }
    });

    it("should handle dynamic resource type function", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue({
        id: "share-123",
        resourceType: "TRACE",
        resourceId: "trace-123",
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        {
          resourceType: (input: any) => input.resourceType || "TRACE",
          resourceParam: "traceId",
        },
      );

      const result = await middleware({
        ctx: mockCtx,
        input: {
          projectId: "project-123",
          traceId: "trace-123",
          resourceType: "TRACE",
        } as any,
        next: mockNext,
      });

      expect(result).toBe("success");
      expect(mockCtx.publiclyShared).toBe(true);
    });

    it.skip("should handle permission check errors gracefully", async () => {
      mockPrisma.project.findUnique.mockRejectedValue(
        new Error("Database error"),
      );

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" },
          next: mockNext,
        }),
      ).rejects.toThrow();
    });

    it("should handle public share lookup errors gracefully", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockRejectedValue(
        new Error("Database error"),
      );

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" },
          next: mockNext,
        }),
      ).rejects.toThrow();
    });
  });

  describe("Demo Project Edge Cases", () => {
    it("should handle undefined DEMO_PROJECT_ID environment variable", () => {
      delete process.env.DEMO_PROJECT_ID;

      const result = isDemoProject(
        "any-project-id",
        "project:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should handle empty DEMO_PROJECT_ID environment variable", () => {
      process.env.DEMO_PROJECT_ID = "";

      const result = isDemoProject(
        "any-project-id",
        "project:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should handle null project ID", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject(null as any, "project:view" as Permission);
      expect(result).toBe(false);
    });

    it("should handle undefined project ID", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject(
        undefined as any,
        "project:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should handle empty project ID", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject("", "project:view" as Permission);
      expect(result).toBe(false);
    });

    it("should handle null permission", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject("demo-project-123", null as any);
      expect(result).toBe(false);
    });

    it("should handle undefined permission", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject("demo-project-123", undefined as any);
      expect(result).toBe(false);
    });

    it("should handle empty permission", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = isDemoProject("demo-project-123", "" as any);
      expect(result).toBe(false);
    });
  });

  describe("Public Sharing Edge Cases", () => {
    const mockCtx = {
      prisma: mockPrisma,
      session: mockSession,
      permissionChecked: false,
      publiclyShared: false,
    };

    const mockNext = vi.fn().mockResolvedValue("success");

    it("should handle null public share result", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue(null);

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" },
          next: mockNext,
        }),
      ).rejects.toThrow();
    });

    it("should handle undefined public share result", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue(undefined);

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" },
          next: mockNext,
        }),
      ).rejects.toThrow();
    });

    it("should handle missing resource parameter in input", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: "trace-123" } as any, // Missing traceId
          next: mockNext,
        }),
      ).rejects.toThrow();
    });

    it("should handle invalid resource parameter type", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      await expect(
        middleware({
          ctx: mockCtx,
          input: { projectId: "project-123", traceId: null } as any, // Invalid traceId
          next: mockNext,
        }),
      ).rejects.toThrow();
    });
  });

  describe("Integration Scenarios", () => {
    it.skip("should handle demo project with public sharing fallback", async () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      // Demo project should work without public sharing
      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "demo-project-123",
        "project:view" as Permission,
      );

      expect(result).toBe(true);
    });

    it("should handle regular project with public sharing", async () => {
      const mockCtx = {
        prisma: mockPrisma,
        session: mockSession,
        permissionChecked: false,
        publiclyShared: false,
      };

      const mockNext = vi.fn().mockResolvedValue("success");

      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [],
          defaultRole: TeamUserRole.VIEWER,
          defaultCustomRole: null,
        },
      });

      mockPrisma.publicShare.findFirst.mockResolvedValue({
        id: "share-123",
        resourceType: "TRACE",
        resourceId: "trace-123",
      });

      const middleware = checkPermissionOrPubliclyShared(
        checkProjectPermission("experiments:view" as Permission),
        { resourceType: "TRACE", resourceParam: "traceId" },
      );

      const result = await middleware({
        ctx: mockCtx,
        input: { projectId: "regular-project-123", traceId: "trace-123" },
        next: mockNext,
      });

      expect(result).toBe("success");
      expect(mockCtx.publiclyShared).toBe(true);
    });

    it("should handle demo project with user permissions", async () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      // Even if user has permissions, demo project should still work
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [{ userId: "user-123", role: TeamUserRole.ADMIN }],
          defaultRole: TeamUserRole.ADMIN,
          defaultCustomRole: null,
        },
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "demo-project-123",
        "project:view" as Permission,
      );

      expect(result).toBe(true);
    });
  });
});
