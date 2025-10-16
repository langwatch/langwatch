import { describe, it, expect } from "vitest";
import { TeamUserRole } from "@prisma/client";
import { teamRoleHasPermission, organizationRoleHasPermission } from "../rbac";
import { OrganizationUserRole } from "@prisma/client";
// Helper function to test permission hierarchy logic
function hasPermissionWithHierarchy(
  permissions: string[],
  requestedPermission: string,
): boolean {
  // Direct match
  if (permissions.includes(requestedPermission)) {
    return true;
  }

  // Hierarchy rule: manage permissions include view permissions
  if (requestedPermission.endsWith(":view")) {
    const managePermission = requestedPermission.replace(":view", ":manage");
    if (permissions.includes(managePermission)) {
      return true;
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
      const permissions = ["messages:share", "triggers:manage"];

      // Share permissions don't follow the view/manage hierarchy
      expect(hasPermissionWithHierarchy(permissions, "messages:share")).toBe(
        true,
      );
      expect(hasPermissionWithHierarchy(permissions, "messages:view")).toBe(
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
});
