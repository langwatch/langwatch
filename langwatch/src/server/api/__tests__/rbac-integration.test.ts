import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkOrganizationPermission,
  checkPermissionOrPubliclyShared,
  checkProjectPermission,
  checkTeamPermission,
  EXTERNAL_MEMBER_PERMISSIONS,
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
  resolveProjectPermission,
  resolveTeamPermission,
  type Permission,
  type PermissionResult,
  skipPermissionCheck,
  skipPermissionCheckProjectCreation,
} from "../rbac";
import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";

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
    findUnique: vi.fn(),
  },
  publicShare: {
    findFirst: vi.fn(),
  },
  groupMembership: {
    findMany: vi.fn(),
  },
  roleBinding: {
    findMany: vi.fn(),
  },
} as any;

// Mock session
const mockSession = {
  user: {
    id: "user-123",
    email: "test@example.com",
  },
} as any;

describe("RBAC Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no group memberships, no role bindings, no team user (falls through to denied)
    mockPrisma.groupMembership.findMany.mockResolvedValue([]);
    mockPrisma.roleBinding.findMany.mockResolvedValue([]);
    mockPrisma.teamUser.findFirst.mockResolvedValue(null);
  });

  describe("hasProjectPermission", () => {
    it("should return false for unauthenticated user", async () => {
      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: null },
        "project-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it.skip("should return true for demo project with view permissions", async () => {
      // Skipped due to environment mocking complexity
      // The hasProjectPermission function uses env.DEMO_PROJECT_ID from ~/env.mjs
      // which requires more complex mocking setup
    });

    it("should return false for demo project with manage permissions", async () => {
      process.env.DEMO_PROJECT_ID = "demo-project-123";

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "demo-project-123",
        "workflows:manage" as Permission,
      );
      expect(result).toBe(false);

      delete process.env.DEMO_PROJECT_ID;
    });

    it("should return false when user is not a team member", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          members: [], // No members
          organization: { members: [] },
        },
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("grants access via group membership when user has no direct teamUser row", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          organizationId: "org-123",
          organization: { members: [] },
        },
      });
      // User belongs to a group (no direct teamUser)
      mockPrisma.groupMembership.findMany.mockResolvedValue([
        { groupId: "group-abc" },
      ]);
      // Group has a MEMBER binding on the team scope
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.MEMBER, customRoleId: null },
      ]);
      mockPrisma.teamUser.findFirst.mockResolvedValue(null);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(true);
    });

    it("should return true when user has built-in role permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          organizationId: "org-123",
          organization: { members: [] },
        },
      });
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.ADMIN, customRoleId: null },
      ]);

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(true);
    });

    it("should return true when user has custom role permission", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-123",
          organizationId: "org-123",
          organization: { members: [] },
        },
      });
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: TeamUserRole.CUSTOM, customRoleId: "custom-role-123" },
      ]);
      mockPrisma.customRole.findUnique.mockResolvedValue({
        permissions: ["workflows:manage"],
      });

      const result = await hasProjectPermission(
        { prisma: mockPrisma, session: mockSession },
        "project-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(true);
    });
  });

  describe("hasTeamPermission", () => {
    it("should return false for unauthenticated user", async () => {
      const result = await hasTeamPermission(
        { prisma: mockPrisma, session: null as any },
        "team-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should return true for organization admin", async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: "team-123",
        organizationId: "org-123",
      });

      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
      });

      const result = await hasTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(true);
    });

    it("should return false when user is not a team member", async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: "team-123",
        organizationId: "org-123",
      });

      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      });

      mockPrisma.teamUser.findFirst.mockResolvedValue(null);

      const result = await hasTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should return true when user has built-in role permission", async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: "team-123",
        organizationId: "org-123",
      });

      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      });

      mockPrisma.teamUser.findFirst.mockResolvedValue({
        role: TeamUserRole.ADMIN,
      });

      mockPrisma.teamUserCustomRole.findFirst.mockResolvedValue(null);

      const result = await hasTeamPermission(
        { prisma: mockPrisma, session: mockSession },
        "team-123",
        "workflows:view" as Permission,
      );
      expect(result).toBe(true);
    });
  });

  describe("hasOrganizationPermission", () => {
    it("should return false for unauthenticated user", async () => {
      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: null as any },
        "org-123",
        "organization:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should return false when user is not organization member", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue(null);
      mockPrisma.teamUser.findFirst.mockResolvedValue(null);

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:view" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should return true for organization admin", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
      });

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:manage" as Permission,
      );
      expect(result).toBe(true);
    });

    it("should return true for organization member with view permission", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      });

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:view" as Permission,
      );
      expect(result).toBe(true);
    });

    it("should return false for organization member with manage permission", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      });

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:manage" as Permission,
      );
      expect(result).toBe(false);
    });

    it("should NOT allow team admin to access organization permissions", async () => {
      // User is organization MEMBER (not admin)
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      });

      // User is team ADMIN in one team
      mockPrisma.teamUser.findFirst.mockResolvedValue({
        userId: "user-123",
        teamId: "team-123",
        role: TeamUserRole.ADMIN,
      });

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:manage" as Permission,
      );

      // Team admin should NOT get organization permissions
      expect(result).toBe(false);
    });

    it("should only allow organization admins to manage organization", async () => {
      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
      });

      const result = await hasOrganizationPermission(
        { prisma: mockPrisma, session: mockSession },
        "org-123",
        "organization:manage" as Permission,
      );

      expect(result).toBe(true);
    });
  });

  describe("Permission Middleware", () => {
    const mockCtx = {
      prisma: mockPrisma,
      session: mockSession,
      permissionChecked: false,
      publiclyShared: false,
    };

    const mockNext = vi.fn().mockResolvedValue("success");

    describe("checkProjectPermission", () => {
      it("should throw UNAUTHORIZED when user lacks permission", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-123",
            members: [],
            organization: { members: [] },
          },
        });

        const middleware = checkProjectPermission(
          "workflows:manage" as Permission,
        );

        await expect(
          middleware({
            ctx: mockCtx,
            input: { projectId: "project-123" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });

      it("should call next when user has permission", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-123",
            organizationId: "org-123",
            organization: { members: [] },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.ADMIN, customRoleId: null },
        ]);

        const middleware = checkProjectPermission(
          "workflows:view" as Permission,
        );

        const result = await middleware({
          ctx: mockCtx,
          input: { projectId: "project-123" },
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.permissionChecked).toBe(true);
      });
    });

    describe("checkTeamPermission", () => {
      it("should throw UNAUTHORIZED when user lacks permission", async () => {
        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-123",
          organizationId: "org-123",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.MEMBER,
        });

        mockPrisma.teamUser.findFirst.mockResolvedValue(null);

        const middleware = checkTeamPermission(
          "workflows:manage" as Permission,
        );

        await expect(
          middleware({
            ctx: mockCtx,
            input: { teamId: "team-123" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });

      it("should call next when user has permission", async () => {
        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-123",
          organizationId: "org-123",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.ADMIN,
        });

        const middleware = checkTeamPermission("workflows:view" as Permission);

        const result = await middleware({
          ctx: mockCtx,
          input: { teamId: "team-123" },
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.permissionChecked).toBe(true);
      });
    });

    describe("checkOrganizationPermission", () => {
      it("should throw UNAUTHORIZED when user lacks permission", async () => {
        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.MEMBER,
        });

        const middleware = checkOrganizationPermission(
          "organization:manage" as Permission,
        );

        await expect(
          middleware({
            ctx: mockCtx,
            input: { organizationId: "org-123" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });

      it("should call next when user has permission", async () => {
        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.ADMIN,
        });

        const middleware = checkOrganizationPermission(
          "organization:view" as Permission,
        );

        const result = await middleware({
          ctx: mockCtx,
          input: { organizationId: "org-123" },
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.permissionChecked).toBe(true);
      });
    });

    describe("skipPermissionCheck", () => {
      it("should call next and set permissionChecked to true", async () => {
        const result = await skipPermissionCheck({
          ctx: mockCtx,
          input: {},
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.permissionChecked).toBe(true);
      });

      it("should throw error when sensitive keys are present", () => {
        expect(() =>
          skipPermissionCheck({
            ctx: mockCtx,
            input: { projectId: "project-123" },
            next: mockNext,
          }),
        ).toThrow(
          "projectId is not allowed to be used without permission check",
        );
      });
    });

    describe("skipPermissionCheckProjectCreation", () => {
      it("should call next and set permissionChecked to true", async () => {
        const result = await skipPermissionCheckProjectCreation({
          ctx: mockCtx,
          input: {},
          next: mockNext,
        });

        expect(result).toBe("success");
        expect(mockCtx.permissionChecked).toBe(true);
      });
    });

    describe("checkPermissionOrPubliclyShared", () => {
      it("should allow access when user has permission", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-123",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.ADMIN, customRoleId: null },
        ]);

        const middleware = checkPermissionOrPubliclyShared(
          checkProjectPermission("workflows:view" as Permission),
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
            organization: { members: [] },
          },
        });

        mockPrisma.publicShare.findFirst.mockResolvedValue({
          id: "share-123",
          resourceType: "TRACE",
          resourceId: "trace-123",
        });

        const middleware = checkPermissionOrPubliclyShared(
          checkProjectPermission("workflows:view" as Permission),
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
            organization: { members: [] },
          },
        });

        mockPrisma.publicShare.findFirst.mockResolvedValue(null);

        const middleware = checkPermissionOrPubliclyShared(
          checkProjectPermission("workflows:view" as Permission),
          { resourceType: "TRACE", resourceParam: "traceId" },
        );

        await expect(
          middleware({
            ctx: mockCtx,
            input: { projectId: "project-123", traceId: "trace-123" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });
    });
  });

  // ==========================================================================
  // resolveProjectPermission
  // ==========================================================================

  describe("resolveProjectPermission", () => {
    function setupProjectMocks({
      orgRole,
      teamRole,
      hasTeamMember = true,
    }: {
      orgRole?: OrganizationUserRole;
      teamRole?: TeamUserRole;
      hasTeamMember?: boolean;
    }) {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-1",
          organizationId: "org-1",
          organization: {
            members: orgRole ? [{ role: orgRole }] : [],
          },
        },
      });
      if (hasTeamMember && teamRole) {
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: teamRole, customRoleId: null },
        ]);
      }
    }

    describe("when user is an org ADMIN and team MEMBER", () => {
      it("grants permission and returns ADMIN org role", async () => {
        setupProjectMocks({
          orgRole: OrganizationUserRole.ADMIN,
          teamRole: TeamUserRole.MEMBER,
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.ADMIN);
      });
    });

    describe("when user is an org MEMBER and team MEMBER", () => {
      it("grants permission and returns MEMBER org role", async () => {
        setupProjectMocks({
          orgRole: OrganizationUserRole.MEMBER,
          teamRole: TeamUserRole.MEMBER,
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.MEMBER);
      });
    });

    describe("when user is an org EXTERNAL and team VIEWER", () => {
      it("grants view permission and returns EXTERNAL org role", async () => {
        setupProjectMocks({
          orgRole: OrganizationUserRole.EXTERNAL,
          teamRole: TeamUserRole.VIEWER,
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
      });
    });

    describe("when user is not an org member", () => {
      it("denies permission and returns null org role", async () => {
        setupProjectMocks({ hasTeamMember: false });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBeNull();
      });
    });

    describe("when project is a demo project", () => {
      it("grants permission and returns null org role", async () => {
        process.env.DEMO_PROJECT_ID = "demo-project-1";
        try {
          const result = await resolveProjectPermission(
            { prisma: mockPrisma, session: mockSession },
            "demo-project-1",
            "analytics:view" as Permission,
          );

          expect(result.permitted).toBe(true);
          expect(result.organizationRole).toBeNull();
        } finally {
          delete process.env.DEMO_PROJECT_ID;
        }
      });
    });

    describe("when user is unauthenticated", () => {
      it("denies permission and returns null org role", async () => {
        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: null },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBeNull();
      });
    });

    describe("when user has CUSTOM role with granted permissions", () => {
      it("grants permission and returns org role", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.groupMembership.findMany.mockResolvedValue([]);
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.CUSTOM, customRoleId: "custom-role-1" },
        ]);

        mockPrisma.customRole.findUnique.mockResolvedValue({
          permissions: ["analytics:view", "datasets:view"],
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.MEMBER);
      });
    });

    describe("when user has CUSTOM role without requested permission", () => {
      it("denies permission and returns org role", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.groupMembership.findMany.mockResolvedValue([]);
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.CUSTOM, customRoleId: "custom-role-1" },
        ]);

        mockPrisma.customRole.findUnique.mockResolvedValue({
          permissions: ["analytics:view"],
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "datasets:manage" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBe(OrganizationUserRole.MEMBER);
      });
    });

    describe("when verifying permission decisions are unchanged (regression)", () => {
      it.each([
        { teamRole: TeamUserRole.ADMIN, permission: "analytics:view", expected: true },
        { teamRole: TeamUserRole.ADMIN, permission: "datasets:manage", expected: true },
        { teamRole: TeamUserRole.ADMIN, permission: "team:manage", expected: true },
        { teamRole: TeamUserRole.MEMBER, permission: "analytics:view", expected: true },
        { teamRole: TeamUserRole.MEMBER, permission: "datasets:manage", expected: true },
        { teamRole: TeamUserRole.MEMBER, permission: "team:manage", expected: false },
        { teamRole: TeamUserRole.VIEWER, permission: "analytics:view", expected: true },
        { teamRole: TeamUserRole.VIEWER, permission: "datasets:manage", expected: false },
        { teamRole: TeamUserRole.VIEWER, permission: "team:manage", expected: false },
      ])(
        "returns permitted=$expected for $teamRole with $permission",
        async ({ teamRole, permission, expected }) => {
          setupProjectMocks({
            orgRole: OrganizationUserRole.MEMBER,
            teamRole,
          });

          const result = await resolveProjectPermission(
            { prisma: mockPrisma, session: mockSession },
            "project-1",
            permission as Permission,
          );

          expect(result.permitted).toBe(expected);
          expect(result.organizationRole).toBe(OrganizationUserRole.MEMBER);
        },
      );
    });

    describe("when verifying org role is carried for each org role type", () => {
      it.each([
        OrganizationUserRole.ADMIN,
        OrganizationUserRole.MEMBER,
        OrganizationUserRole.EXTERNAL,
      ])("returns org role %s", async (orgRole) => {
        setupProjectMocks({
          orgRole,
          teamRole: TeamUserRole.MEMBER,
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result.organizationRole).toBe(orgRole);
      });
    });
  });

  // ==========================================================================
  // resolveTeamPermission
  // ==========================================================================

  describe("resolveTeamPermission", () => {
    function setupTeamMocks({
      orgRole,
      teamRole,
      hasTeamUser = true,
    }: {
      orgRole?: OrganizationUserRole;
      teamRole?: TeamUserRole;
      hasTeamUser?: boolean;
    }) {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: "team-1",
        organizationId: "org-1",
      });

      mockPrisma.organizationUser.findFirst.mockResolvedValue(
        orgRole ? { role: orgRole } : null,
      );

      mockPrisma.teamUser.findFirst.mockResolvedValue(
        hasTeamUser && teamRole
          ? { userId: "user-123", teamId: "team-1", role: teamRole }
          : null,
      );
    }

    describe("when user is an org ADMIN (admin bypass, not a team member)", () => {
      it("grants permission and returns ADMIN org role", async () => {
        setupTeamMocks({
          orgRole: OrganizationUserRole.ADMIN,
          hasTeamUser: false,
        });

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:manage" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.ADMIN);
      });
    });

    describe("when user is an org MEMBER and team MEMBER", () => {
      it("grants permission and returns MEMBER org role", async () => {
        setupTeamMocks({
          orgRole: OrganizationUserRole.MEMBER,
          teamRole: TeamUserRole.MEMBER,
        });

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.MEMBER);
      });
    });

    describe("when user is an org EXTERNAL and team VIEWER", () => {
      it("grants allowed permission and returns EXTERNAL org role", async () => {
        setupTeamMocks({
          orgRole: OrganizationUserRole.EXTERNAL,
          teamRole: TeamUserRole.VIEWER,
        });

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "analytics:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
      });

      it("denies manage permission and returns EXTERNAL org role", async () => {
        setupTeamMocks({
          orgRole: OrganizationUserRole.EXTERNAL,
          teamRole: TeamUserRole.VIEWER,
        });

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:manage" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
      });
    });

    describe("when user is not an org member", () => {
      it("denies permission and returns null org role", async () => {
        setupTeamMocks({ hasTeamUser: false });

        const result = await resolveTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:view" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBeNull();
      });
    });
  });

  // ==========================================================================
  // Boolean API regression guards
  // ==========================================================================

  describe("boolean API regression", () => {
    describe("when hasProjectPermission is called", () => {
      it("returns true (boolean) when user has permission", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.MEMBER, customRoleId: null },
        ]);

        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "analytics:view" as Permission,
        );

        expect(result).toBe(true);
        expect(typeof result).toBe("boolean");
      });

      it("returns false (boolean) when user lacks permission", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.VIEWER, customRoleId: null },
        ]);

        const result = await hasProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "datasets:manage" as Permission,
        );

        expect(result).toBe(false);
        expect(typeof result).toBe("boolean");
      });
    });

    describe("when hasTeamPermission is called", () => {
      it("returns true (boolean) when user has permission", async () => {
        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-1",
          organizationId: "org-1",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.MEMBER,
        });

        mockPrisma.teamUser.findFirst.mockResolvedValue({
          userId: "user-123",
          teamId: "team-1",
          role: TeamUserRole.MEMBER,
        });

        const result = await hasTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:view" as Permission,
        );

        expect(result).toBe(true);
        expect(typeof result).toBe("boolean");
      });

      it("returns false (boolean) when user lacks permission", async () => {
        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-1",
          organizationId: "org-1",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.MEMBER,
        });

        mockPrisma.teamUser.findFirst.mockResolvedValue({
          userId: "user-123",
          teamId: "team-1",
          role: TeamUserRole.VIEWER,
        });

        const result = await hasTeamPermission(
          { prisma: mockPrisma, session: mockSession },
          "team-1",
          "team:manage" as Permission,
        );

        expect(result).toBe(false);
        expect(typeof result).toBe("boolean");
      });
    });
  });

  // ==========================================================================
  // Middleware passes org role to downstream context
  // ==========================================================================

  describe("middleware org role propagation", () => {
    describe("when checkProjectPermission middleware runs for a permitted user", () => {
      it("sets organizationRole on context", async () => {
        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.MEMBER, customRoleId: null },
        ]);

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkProjectPermission(
          "analytics:view" as Permission,
        );

        await middleware({
          ctx,
          input: { projectId: "project-1" },
          next: mockNext,
        });

        expect(ctx.organizationRole).toBe(OrganizationUserRole.MEMBER);
        expect(ctx.permissionChecked).toBe(true);
      });
    });

    describe("when checkTeamPermission middleware runs for a permitted user", () => {
      it("sets organizationRole on context", async () => {
        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-1",
          organizationId: "org-1",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          role: OrganizationUserRole.ADMIN,
        });

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkTeamPermission("team:view" as Permission);

        await middleware({
          ctx,
          input: { teamId: "team-1" },
          next: mockNext,
        });

        expect(ctx.organizationRole).toBe(OrganizationUserRole.ADMIN);
        expect(ctx.permissionChecked).toBe(true);
      });
    });

    describe("when checkProjectPermission middleware denies access", () => {
      it("throws UNAUTHORIZED", async () => {
        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
        };

        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            members: [],
            organization: {
              members: [],
            },
          },
        });

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkProjectPermission(
          "analytics:view" as Permission,
        );

        await expect(
          middleware({
            ctx,
            input: { projectId: "project-1" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });
    });

    describe("when checkTeamPermission middleware denies access", () => {
      it("throws UNAUTHORIZED", async () => {
        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
        };

        mockPrisma.team.findUnique.mockResolvedValue({
          id: "team-1",
          organizationId: "org-1",
        });

        mockPrisma.organizationUser.findFirst.mockResolvedValue(null);
        mockPrisma.teamUser.findFirst.mockResolvedValue(null);

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkTeamPermission("team:view" as Permission);

        await expect(
          middleware({
            ctx,
            input: { teamId: "team-1" },
            next: mockNext,
          }),
        ).rejects.toThrow(TRPCError);
      });
    });

    describe("when public share fallback middleware runs for a permitted user", () => {
      it("passes org role via checkProjectPermission", async () => {
        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.MEMBER, customRoleId: null },
        ]);

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkPermissionOrPubliclyShared(
          checkProjectPermission("analytics:view" as Permission),
          { resourceType: "TRACE", resourceParam: "traceId" },
        );

        await middleware({
          ctx,
          input: { projectId: "project-1", traceId: "trace-1" },
          next: mockNext,
        });

        expect(ctx.organizationRole).toBe(OrganizationUserRole.MEMBER);
        expect(ctx.permissionChecked).toBe(true);
      });
    });
  });

  // ==========================================================================
  // EXTERNAL (lite member) restriction logic
  // ==========================================================================

  describe("EXTERNAL (lite member) restriction logic", () => {
    function setupProjectWithExternalUser({
      teamRole = TeamUserRole.VIEWER,
      assignedRoleId,
    }: {
      teamRole?: TeamUserRole;
      assignedRoleId?: string;
    } = {}) {
      mockPrisma.project.findUnique.mockResolvedValue({
        team: {
          id: "team-1",
          organizationId: "org-1",
          organization: {
            members: [{ role: OrganizationUserRole.EXTERNAL }],
          },
        },
      });
      mockPrisma.roleBinding.findMany.mockResolvedValue([
        { role: teamRole, customRoleId: assignedRoleId ?? null },
      ]);
    }

    function setupTeamWithExternalUser({
      teamRole = TeamUserRole.VIEWER,
      assignedRoleId,
    }: {
      teamRole?: TeamUserRole;
      assignedRoleId?: string;
    } = {}) {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: "team-1",
        organizationId: "org-1",
      });

      mockPrisma.organizationUser.findFirst.mockResolvedValue({
        role: OrganizationUserRole.EXTERNAL,
      });

      mockPrisma.teamUser.findFirst.mockResolvedValue({
        userId: "user-123",
        teamId: "team-1",
        role: teamRole,
        assignedRoleId: assignedRoleId ?? null,
      });
    }

    describe("when EXTERNAL user requests a mutate permission via project", () => {
      it.each([
        "datasets:manage",
        "prompts:manage",
        "annotations:manage",
        "evaluations:manage",
        "workflows:manage",
        "scenarios:manage",
        "secrets:manage",
        "team:manage",
        "project:manage",
        "project:create",
        "project:update",
        "project:delete",
        "triggers:manage",
      ] as Permission[])(
        "denies %s",
        async (permission) => {
          setupProjectWithExternalUser();

          const result = await resolveProjectPermission(
            { prisma: mockPrisma, session: mockSession },
            "project-1",
            permission,
          );

          expect(result.permitted).toBe(false);
          expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
        },
      );
    });

    describe("when EXTERNAL user requests an allowed permission via project", () => {
      it.each([
        "project:view",
        "analytics:view",
        "traces:view",
        "annotations:view",
        "annotations:create",
        "annotations:update",
        "evaluations:view",
        "datasets:view",
        "workflows:view",
        "prompts:view",
        "scenarios:view",
        "secrets:view",
        "team:view",
      ] as Permission[])(
        "grants %s",
        async (permission) => {
          setupProjectWithExternalUser();

          const result = await resolveProjectPermission(
            { prisma: mockPrisma, session: mockSession },
            "project-1",
            permission,
          );

          expect(result.permitted).toBe(true);
          expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
        },
      );
    });

    describe("when EXTERNAL user requests a mutate permission via team", () => {
      it.each([
        "datasets:manage",
        "prompts:manage",
        "annotations:manage",
        "evaluations:manage",
        "workflows:manage",
        "scenarios:manage",
        "secrets:manage",
        "team:manage",
      ] as Permission[])(
        "denies %s",
        async (permission) => {
          setupTeamWithExternalUser();

          const result = await resolveTeamPermission(
            { prisma: mockPrisma, session: mockSession },
            "team-1",
            permission,
          );

          expect(result.permitted).toBe(false);
          expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
        },
      );
    });

    describe("when EXTERNAL user requests an allowed permission via team", () => {
      it.each([
        "project:view",
        "analytics:view",
        "traces:view",
        "annotations:view",
        "annotations:create",
        "annotations:update",
        "evaluations:view",
        "datasets:view",
        "workflows:view",
        "prompts:view",
        "scenarios:view",
        "secrets:view",
        "team:view",
      ] as Permission[])(
        "grants %s",
        async (permission) => {
          setupTeamWithExternalUser();

          const result = await resolveTeamPermission(
            { prisma: mockPrisma, session: mockSession },
            "team-1",
            permission,
          );

          expect(result.permitted).toBe(true);
          expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
        },
      );
    });

    describe("when EXTERNAL user has a custom role granting additional permissions", () => {
      it("grants the custom role permission (overrides restricted defaults)", async () => {
        setupProjectWithExternalUser({
          teamRole: TeamUserRole.CUSTOM,
          assignedRoleId: "custom-role-1",
        });

        mockPrisma.customRole.findUnique.mockResolvedValue({
          permissions: ["datasets:view", "prompts:view"],
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "datasets:view" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
      });

      it("denies permissions not in the custom role", async () => {
        setupProjectWithExternalUser({
          teamRole: TeamUserRole.CUSTOM,
          assignedRoleId: "custom-role-1",
        });

        mockPrisma.customRole.findUnique.mockResolvedValue({
          permissions: ["datasets:view"],
        });

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "prompts:view" as Permission,
        );

        expect(result.permitted).toBe(false);
        expect(result.organizationRole).toBe(OrganizationUserRole.EXTERNAL);
      });
    });

    describe("when non-EXTERNAL user (MEMBER) has VIEWER team role", () => {
      it.each([
        "datasets:view",
        "prompts:view",
        "secrets:view",
      ] as Permission[])(
        "grants %s",
        async (permission) => {
          mockPrisma.project.findUnique.mockResolvedValue({
            team: {
              id: "team-1",
              organizationId: "org-1",
              organization: {
                members: [{ role: OrganizationUserRole.MEMBER }],
              },
            },
          });
          mockPrisma.groupMembership.findMany.mockResolvedValue([]);
          mockPrisma.roleBinding.findMany.mockResolvedValue([
            { role: TeamUserRole.VIEWER, customRoleId: null },
          ]);

          const result = await resolveProjectPermission(
            { prisma: mockPrisma, session: mockSession },
            "project-1",
            permission,
          );

          expect(result.permitted).toBe(true);
        },
      );
    });

    describe("when non-EXTERNAL user (ADMIN org role) accesses resources", () => {
      it("grants full team-role-based access", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            organization: {
              members: [{ role: OrganizationUserRole.ADMIN }],
            },
          },
        });
        mockPrisma.groupMembership.findMany.mockResolvedValue([]);
        mockPrisma.roleBinding.findMany.mockResolvedValue([
          { role: TeamUserRole.ADMIN, customRoleId: null },
        ]);

        const result = await resolveProjectPermission(
          { prisma: mockPrisma, session: mockSession },
          "project-1",
          "datasets:manage" as Permission,
        );

        expect(result.permitted).toBe(true);
        expect(result.organizationRole).toBe(OrganizationUserRole.ADMIN);
      });
    });

    describe("when checkProjectPermission middleware denies EXTERNAL user", () => {
      it("throws TRPCError with LiteMemberRestrictedError cause", async () => {
        setupProjectWithExternalUser();

        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkProjectPermission("datasets:manage" as Permission);

        try {
          await middleware({
            ctx,
            input: { projectId: "project-1" },
            next: mockNext,
          });
          expect.unreachable("Expected middleware to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
          const trpcError = error as TRPCError;
          expect(trpcError.code).toBe("UNAUTHORIZED");
          expect(trpcError.message).toBe("This feature is not available for your account");
          expect(trpcError.cause).toBeInstanceOf(LiteMemberRestrictedError);
          expect((trpcError.cause as LiteMemberRestrictedError).meta.resource).toBe("datasets");
        }
      });
    });

    describe("when checkTeamPermission middleware denies EXTERNAL user", () => {
      it("throws TRPCError with LiteMemberRestrictedError cause", async () => {
        setupTeamWithExternalUser();

        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkTeamPermission("datasets:manage" as Permission);

        try {
          await middleware({
            ctx,
            input: { teamId: "team-1" },
            next: mockNext,
          });
          expect.unreachable("Expected middleware to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
          const trpcError = error as TRPCError;
          expect(trpcError.code).toBe("UNAUTHORIZED");
          expect(trpcError.message).toBe("This feature is not available for your account");
          expect(trpcError.cause).toBeInstanceOf(LiteMemberRestrictedError);
          expect((trpcError.cause as LiteMemberRestrictedError).meta.resource).toBe("datasets");
        }
      });
    });

    describe("when checkProjectPermission middleware denies non-EXTERNAL user", () => {
      it("throws generic UNAUTHORIZED without LiteMemberRestrictedError", async () => {
        mockPrisma.project.findUnique.mockResolvedValue({
          team: {
            id: "team-1",
            organizationId: "org-1",
            members: [],
            organization: {
              members: [{ role: OrganizationUserRole.MEMBER }],
            },
          },
        });

        const ctx = {
          prisma: mockPrisma,
          session: mockSession,
          permissionChecked: false,
          publiclyShared: false,
          organizationRole: undefined as OrganizationUserRole | null | undefined,
        };

        const mockNext = vi.fn().mockResolvedValue("success");
        const middleware = checkProjectPermission("datasets:view" as Permission);

        try {
          await middleware({
            ctx,
            input: { projectId: "project-1" },
            next: mockNext,
          });
          expect.unreachable("Expected middleware to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
          const trpcError = error as TRPCError;
          expect(trpcError.code).toBe("UNAUTHORIZED");
          expect(trpcError.message).toBe("You do not have permission to access this project resource");
          expect(trpcError.cause).toBeUndefined();
        }
      });
    });

    describe("when EXTERNAL_MEMBER_PERMISSIONS constant is defined", () => {
      it("includes view permissions plus annotation create and update", () => {
        expect(EXTERNAL_MEMBER_PERMISSIONS).toEqual([
          "project:view",
          "analytics:view",
          "traces:view",
          "annotations:view",
          "annotations:create",
          "annotations:update",
          "evaluations:view",
          "datasets:view",
          "workflows:view",
          "prompts:view",
          "scenarios:view",
          "secrets:view",
          "team:view",
        ]);
      });
    });
  });
});
