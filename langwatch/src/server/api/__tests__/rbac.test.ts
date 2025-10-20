import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeamUserRole, OrganizationUserRole } from "@prisma/client";
import {
  teamRoleHasPermission,
  organizationRoleHasPermission,
  getTeamRolePermissions,
  getOrganizationRolePermissions,
  canView,
  canManage,
  canCreate,
  canUpdate,
  canDelete,
  isDemoProject,
  Resources,
  Actions,
  type Permission,
} from "../rbac";

// Helper function to test permission hierarchy logic
function hasPermissionWithHierarchy(
  permissions: string[],
  requestedPermission: string,
): boolean {
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

describe("RBAC Permission System", () => {
  describe("Permission Hierarchy Logic", () => {
    it("should allow direct permission match", () => {
      const permissions = ["experiments:view", "datasets:manage"];

      expect(hasPermissionWithHierarchy(permissions, "experiments:view")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "datasets:manage")).toBe(
        true,
      );
    });

    it("should allow manage permissions to include view permissions", () => {
      const permissions = ["experiments:manage"];

      expect(hasPermissionWithHierarchy(permissions, "experiments:view")).toBe(
        true,
      );
      expect(
        hasPermissionWithHierarchy(permissions, "experiments:manage"),
      ).toBe(true);
    });

    it("should not allow view permissions to include manage permissions", () => {
      const permissions = ["experiments:view"];

      expect(hasPermissionWithHierarchy(permissions, "experiments:view")).toBe(
        true,
      );
      expect(
        hasPermissionWithHierarchy(permissions, "experiments:manage"),
      ).toBe(false);
    });

    it("should not allow unrelated permissions", () => {
      const permissions = ["datasets:view"];

      expect(hasPermissionWithHierarchy(permissions, "experiments:view")).toBe(
        false,
      );
      expect(
        hasPermissionWithHierarchy(permissions, "experiments:manage"),
      ).toBe(false);
    });

    it("should work with different resource types", () => {
      const permissions = [
        "analytics:manage",
        "guardrails:manage",
        "prompts:manage",
      ];

      expect(hasPermissionWithHierarchy(permissions, "analytics:view")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "guardrails:view")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "prompts:view")).toBe(
        true,
      );
    });

    it("should handle empty permissions array", () => {
      const permissions: string[] = [];

      expect(hasPermissionWithHierarchy(permissions, "experiments:view")).toBe(
        false,
      );
      expect(
        hasPermissionWithHierarchy(permissions, "experiments:manage"),
      ).toBe(false);
    });
  });

  describe("Team Role Permissions", () => {
    it("should allow ADMIN to access all experiment permissions", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.ADMIN, "experiments:view"),
      ).toBe(true);
      expect(
        teamRoleHasPermission(TeamUserRole.ADMIN, "experiments:manage"),
      ).toBe(true);
    });

    it("should allow MEMBER to access all experiment permissions", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.MEMBER, "experiments:view"),
      ).toBe(true);
      expect(
        teamRoleHasPermission(TeamUserRole.MEMBER, "experiments:manage"),
      ).toBe(true);
    });

    it("should allow VIEWER to access only experiment view permissions", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.VIEWER, "experiments:view"),
      ).toBe(true);
      expect(
        teamRoleHasPermission(TeamUserRole.VIEWER, "experiments:manage"),
      ).toBe(false);
    });

    it("should allow ADMIN to access all project permissions", () => {
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "project:view")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "project:create")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "project:update")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "project:delete")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "project:manage")).toBe(
        true,
      );
    });

    it("should allow MEMBER to access limited project permissions", () => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "project:view")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "project:update")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "project:create")).toBe(
        false,
      );
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "project:delete")).toBe(
        false,
      );
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "project:manage")).toBe(
        false,
      );
    });

    it("should allow VIEWER to access only project view permissions", () => {
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "project:view")).toBe(
        true,
      );
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "project:update")).toBe(
        false,
      );
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "project:create")).toBe(
        false,
      );
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "project:delete")).toBe(
        false,
      );
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "project:manage")).toBe(
        false,
      );
    });
  });

  describe("Organization Role Permissions", () => {
    it("should allow ORGANIZATION_ADMIN to access organization permissions", () => {
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.ADMIN,
          "organization:view",
        ),
      ).toBe(true);
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.ADMIN,
          "organization:manage",
        ),
      ).toBe(true);
    });

    it("should allow ORGANIZATION_MEMBER to access organization view permissions", () => {
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.MEMBER,
          "organization:view",
        ),
      ).toBe(true);
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.MEMBER,
          "organization:manage",
        ),
      ).toBe(false);
    });

    it("should allow ORGANIZATION_EXTERNAL to access organization view permissions", () => {
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.EXTERNAL,
          "organization:view",
        ),
      ).toBe(true);
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.EXTERNAL,
          "organization:manage",
        ),
      ).toBe(false);
    });
  });

  describe("Custom Role Scenarios", () => {
    it("should simulate custom role with only manage permission", () => {
      // Simulate a custom role that only has experiments:manage
      const customPermissions = ["experiments:manage"];

      // Should be able to access both view and manage
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:manage"),
      ).toBe(true);
    });

    it("should simulate custom role with only view permission", () => {
      // Simulate a custom role that only has experiments:view
      const customPermissions = ["experiments:view"];

      // Should only be able to access view
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:manage"),
      ).toBe(false);
    });

    it("should simulate custom role with mixed permissions", () => {
      // Simulate a custom role with mixed permissions
      const customPermissions = [
        "experiments:manage",
        "datasets:view",
        "analytics:manage",
      ];

      // Should work correctly for each permission type
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "experiments:manage"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "datasets:manage"),
      ).toBe(false);
      expect(
        hasPermissionWithHierarchy(customPermissions, "analytics:view"),
      ).toBe(true);
      expect(
        hasPermissionWithHierarchy(customPermissions, "analytics:manage"),
      ).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle permissions with different action types", () => {
      const permissions = ["traces:share", "triggers:manage"];

      // Share permissions don't follow the view/manage hierarchy
      expect(hasPermissionWithHierarchy(permissions, "traces:share")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "traces:view")).toBe(
        false,
      );

      // Manage permissions should include view
      expect(hasPermissionWithHierarchy(permissions, "triggers:view")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "triggers:manage")).toBe(
        true,
      );
    });

    it("should handle malformed permission strings", () => {
      const permissions = ["experiments:manage"];

      // Should not match malformed strings
      expect(hasPermissionWithHierarchy(permissions, "experiments:")).toBe(
        false,
      );
      expect(hasPermissionWithHierarchy(permissions, ":view")).toBe(false);
      expect(hasPermissionWithHierarchy(permissions, "experiments")).toBe(
        false,
      );
    });

    it("should handle case sensitivity", () => {
      const permissions = ["experiments:manage"];

      // Should be case sensitive
      expect(hasPermissionWithHierarchy(permissions, "Experiments:view")).toBe(
        false,
      );
      expect(hasPermissionWithHierarchy(permissions, "EXPERIMENTS:VIEW")).toBe(
        false,
      );
    });
  });

  describe("Permission Helper Functions", () => {
    describe("canView", () => {
      it("should return true for ADMIN role on all resources", () => {
        expect(canView(TeamUserRole.ADMIN, Resources.EXPERIMENTS)).toBe(true);
        expect(canView(TeamUserRole.ADMIN, Resources.DATASETS)).toBe(true);
        expect(canView(TeamUserRole.ADMIN, Resources.ANALYTICS)).toBe(true);
        expect(canView(TeamUserRole.ADMIN, Resources.TRACES)).toBe(true);
      });

      it("should return true for MEMBER role on all resources", () => {
        expect(canView(TeamUserRole.MEMBER, Resources.EXPERIMENTS)).toBe(true);
        expect(canView(TeamUserRole.MEMBER, Resources.DATASETS)).toBe(true);
        expect(canView(TeamUserRole.MEMBER, Resources.ANALYTICS)).toBe(true);
        expect(canView(TeamUserRole.MEMBER, Resources.TRACES)).toBe(true);
      });

      it("should return true for VIEWER role on most resources", () => {
        expect(canView(TeamUserRole.VIEWER, Resources.EXPERIMENTS)).toBe(true);
        expect(canView(TeamUserRole.VIEWER, Resources.DATASETS)).toBe(true);
        expect(canView(TeamUserRole.VIEWER, Resources.ANALYTICS)).toBe(true);
        expect(canView(TeamUserRole.VIEWER, Resources.TRACES)).toBe(true);
      });

      it("should return false for VIEWER role on cost resource", () => {
        expect(canView(TeamUserRole.VIEWER, Resources.COST)).toBe(false);
      });
    });

    describe("canManage", () => {
      it("should return true for ADMIN role on all resources", () => {
        expect(canManage(TeamUserRole.ADMIN, Resources.EXPERIMENTS)).toBe(true);
        expect(canManage(TeamUserRole.ADMIN, Resources.DATASETS)).toBe(true);
        expect(canManage(TeamUserRole.ADMIN, Resources.ANALYTICS)).toBe(true);
        // Traces only has view and share, not manage
        expect(canManage(TeamUserRole.ADMIN, Resources.TRACES)).toBe(false);
      });

      it("should return true for MEMBER role on most resources", () => {
        expect(canManage(TeamUserRole.MEMBER, Resources.EXPERIMENTS)).toBe(
          true,
        );
        expect(canManage(TeamUserRole.MEMBER, Resources.DATASETS)).toBe(true);
        expect(canManage(TeamUserRole.MEMBER, Resources.ANALYTICS)).toBe(true);
        // Traces only has view and share, not manage
        expect(canManage(TeamUserRole.MEMBER, Resources.TRACES)).toBe(false);
      });

      it("should return false for MEMBER role on project resource", () => {
        expect(canManage(TeamUserRole.MEMBER, Resources.PROJECT)).toBe(false);
      });

      it("should return false for VIEWER role on all resources", () => {
        expect(canManage(TeamUserRole.VIEWER, Resources.EXPERIMENTS)).toBe(
          false,
        );
        expect(canManage(TeamUserRole.VIEWER, Resources.DATASETS)).toBe(false);
        expect(canManage(TeamUserRole.VIEWER, Resources.ANALYTICS)).toBe(false);
        expect(canManage(TeamUserRole.VIEWER, Resources.TRACES)).toBe(false);
      });
    });

    describe("canCreate", () => {
      it("should return true for ADMIN role on project resource", () => {
        expect(canCreate(TeamUserRole.ADMIN, Resources.PROJECT)).toBe(true);
      });

      it("should return false for MEMBER role on project resource", () => {
        expect(canCreate(TeamUserRole.MEMBER, Resources.PROJECT)).toBe(false);
      });

      it("should return false for VIEWER role on project resource", () => {
        expect(canCreate(TeamUserRole.VIEWER, Resources.PROJECT)).toBe(false);
      });
    });

    describe("canUpdate", () => {
      it("should return true for ADMIN role on project resource", () => {
        expect(canUpdate(TeamUserRole.ADMIN, Resources.PROJECT)).toBe(true);
      });

      it("should return true for MEMBER role on project resource", () => {
        expect(canUpdate(TeamUserRole.MEMBER, Resources.PROJECT)).toBe(true);
      });

      it("should return false for VIEWER role on project resource", () => {
        expect(canUpdate(TeamUserRole.VIEWER, Resources.PROJECT)).toBe(false);
      });
    });

    describe("canDelete", () => {
      it("should return true for ADMIN role on project resource", () => {
        expect(canDelete(TeamUserRole.ADMIN, Resources.PROJECT)).toBe(true);
      });

      it("should return false for MEMBER role on project resource", () => {
        expect(canDelete(TeamUserRole.MEMBER, Resources.PROJECT)).toBe(false);
      });

      it("should return false for VIEWER role on project resource", () => {
        expect(canDelete(TeamUserRole.VIEWER, Resources.PROJECT)).toBe(false);
      });
    });
  });

  describe("Permission Retrieval Functions", () => {
    describe("getTeamRolePermissions", () => {
      it("should return all permissions for ADMIN role", () => {
        const permissions = getTeamRolePermissions(TeamUserRole.ADMIN);
        expect(permissions).toContain("project:view");
        expect(permissions).toContain("project:create");
        expect(permissions).toContain("project:update");
        expect(permissions).toContain("project:delete");
        expect(permissions).toContain("project:manage");
        expect(permissions).toContain("experiments:view");
        expect(permissions).toContain("experiments:manage");
        expect(permissions).toContain("team:manage");
      });

      it("should return limited permissions for MEMBER role", () => {
        const permissions = getTeamRolePermissions(TeamUserRole.MEMBER);
        expect(permissions).toContain("project:view");
        expect(permissions).toContain("project:update");
        expect(permissions).not.toContain("project:create");
        expect(permissions).not.toContain("project:delete");
        expect(permissions).not.toContain("project:manage");
        expect(permissions).toContain("experiments:view");
        expect(permissions).toContain("experiments:manage");
        expect(permissions).not.toContain("team:manage");
      });

      it("should return view-only permissions for VIEWER role", () => {
        const permissions = getTeamRolePermissions(TeamUserRole.VIEWER);
        expect(permissions).toContain("project:view");
        expect(permissions).not.toContain("project:create");
        expect(permissions).not.toContain("project:update");
        expect(permissions).not.toContain("project:delete");
        expect(permissions).not.toContain("project:manage");
        expect(permissions).toContain("experiments:view");
        expect(permissions).not.toContain("experiments:manage");
        expect(permissions).not.toContain("team:manage");
      });
    });

    describe("getOrganizationRolePermissions", () => {
      it("should return all permissions for ORGANIZATION_ADMIN", () => {
        const permissions = getOrganizationRolePermissions(
          OrganizationUserRole.ADMIN,
        );
        expect(permissions).toContain("organization:view");
        expect(permissions).toContain("organization:manage");
        expect(permissions).toContain("organization:delete");
      });

      it("should return limited permissions for ORGANIZATION_MEMBER", () => {
        const permissions = getOrganizationRolePermissions(
          OrganizationUserRole.MEMBER,
        );
        expect(permissions).toContain("organization:view");
        expect(permissions).not.toContain("organization:manage");
        expect(permissions).not.toContain("organization:delete");
      });

      it("should return limited permissions for ORGANIZATION_EXTERNAL", () => {
        const permissions = getOrganizationRolePermissions(
          OrganizationUserRole.EXTERNAL,
        );
        expect(permissions).toContain("organization:view");
        expect(permissions).not.toContain("organization:manage");
        expect(permissions).not.toContain("organization:delete");
      });
    });
  });

  describe("Demo Project Functionality", () => {
    // Note: Demo project tests are skipped due to environment mocking complexity
    // The isDemoProject function uses env.DEMO_PROJECT_ID from ~/env.mjs
    // which requires more complex mocking setup
    it.skip("should allow view permissions for demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should not allow manage permissions for demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should not allow create permissions for demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should not allow update permissions for demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should not allow delete permissions for demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should return false for non-demo project", () => {
      // This test would require mocking the env module
    });

    it.skip("should allow playground view for demo project", () => {
      // This test would require mocking the env module
    });
  });

  describe("Permission Constants", () => {
    it("should have all expected resources defined", () => {
      expect(Resources.ORGANIZATION).toBe("organization");
      expect(Resources.PROJECT).toBe("project");
      expect(Resources.TEAM).toBe("team");
      expect(Resources.ANALYTICS).toBe("analytics");
      expect(Resources.COST).toBe("cost");
      expect(Resources.TRACES).toBe("traces");
      expect(Resources.SCENARIOS).toBe("scenarios");
      expect(Resources.ANNOTATIONS).toBe("annotations");
      expect(Resources.GUARDRAILS).toBe("guardrails");
      expect(Resources.EXPERIMENTS).toBe("experiments");
      expect(Resources.DATASETS).toBe("datasets");
      expect(Resources.TRIGGERS).toBe("triggers");
      expect(Resources.WORKFLOWS).toBe("workflows");
      expect(Resources.PROMPTS).toBe("prompts");
      expect(Resources.PLAYGROUND).toBe("playground");
    });

    it("should have all expected actions defined", () => {
      expect(Actions.VIEW).toBe("view");
      expect(Actions.CREATE).toBe("create");
      expect(Actions.UPDATE).toBe("update");
      expect(Actions.DELETE).toBe("delete");
      expect(Actions.MANAGE).toBe("manage");
      expect(Actions.SHARE).toBe("share");
    });
  });

  describe("Permission Type Safety", () => {
    it("should create valid permission strings", () => {
      const permission: Permission = `${Resources.EXPERIMENTS}:${Actions.VIEW}`;
      expect(permission).toBe("experiments:view");

      const managePermission: Permission = `${Resources.DATASETS}:${Actions.MANAGE}`;
      expect(managePermission).toBe("datasets:manage");
    });

    it("should validate permission format", () => {
      const validPermissions: Permission[] = [
        "experiments:view",
        "datasets:manage",
        "analytics:create",
        "traces:share",
        "project:delete",
      ];

      validPermissions.forEach((permission) => {
        expect(permission).toMatch(/^[a-z]+:[a-z]+$/);
      });
    });
  });

  describe("Complex Permission Scenarios", () => {
    it("should handle all CRUD operations for ADMIN role", () => {
      const adminPermissions = getTeamRolePermissions(TeamUserRole.ADMIN);

      // Should have all CRUD operations for project (only resource with individual CRUD)
      expect(adminPermissions).toContain("project:view");
      expect(adminPermissions).toContain("project:create");
      expect(adminPermissions).toContain("project:update");
      expect(adminPermissions).toContain("project:delete");
      expect(adminPermissions).toContain("project:manage");

      // Should have manage permissions for other resources (which include CRUD via hierarchy)
      expect(adminPermissions).toContain("experiments:view");
      expect(adminPermissions).toContain("experiments:manage");
      expect(adminPermissions).toContain("datasets:view");
      expect(adminPermissions).toContain("datasets:manage");
    });

    it("should handle mixed permissions for MEMBER role", () => {
      const memberPermissions = getTeamRolePermissions(TeamUserRole.MEMBER);

      // Should have manage permissions for most resources
      expect(memberPermissions).toContain("experiments:manage");
      expect(memberPermissions).toContain("datasets:manage");
      expect(memberPermissions).toContain("analytics:manage");

      // Should have limited project permissions
      expect(memberPermissions).toContain("project:view");
      expect(memberPermissions).toContain("project:update");
      expect(memberPermissions).not.toContain("project:create");
      expect(memberPermissions).not.toContain("project:delete");
      expect(memberPermissions).not.toContain("project:manage");
    });

    it("should handle view-only permissions for VIEWER role", () => {
      const viewerPermissions = getTeamRolePermissions(TeamUserRole.VIEWER);

      // Should only have view permissions
      expect(viewerPermissions).toContain("experiments:view");
      expect(viewerPermissions).not.toContain("experiments:create");
      expect(viewerPermissions).not.toContain("experiments:update");
      expect(viewerPermissions).not.toContain("experiments:delete");
      expect(viewerPermissions).not.toContain("experiments:manage");

      expect(viewerPermissions).toContain("datasets:view");
      expect(viewerPermissions).not.toContain("datasets:create");
      expect(viewerPermissions).not.toContain("datasets:update");
      expect(viewerPermissions).not.toContain("datasets:delete");
      expect(viewerPermissions).not.toContain("datasets:manage");
    });
  });
});
