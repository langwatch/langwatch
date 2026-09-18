import {
  AUTHZ_RESOURCES,
  builtinRoleGrants,
  builtinRolePermissions,
  roleKeyForTeamRole,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../../../utils/permissionsConfig";

const teamRoleHasPermission = (role: TeamUserRole, permission: string) =>
  builtinRoleGrants({ role: roleKeyForTeamRole(role), permission });
const getOrganizationRolePermissions = (role: OrganizationUserRole) => [
  ...builtinRolePermissions(
    role === OrganizationUserRole.ADMIN ? "org-admin" : "org-member",
  ),
];
const canView = (role: TeamUserRole, resource: string) =>
  teamRoleHasPermission(role, `${resource}:view`);
const canManage = (role: TeamUserRole, resource: string) =>
  teamRoleHasPermission(role, `${resource}:manage`);

describe("Secrets resource in RBAC", () => {
  describe("given the permission registry", () => {
    it("includes a SECRETS entry with value 'secrets'", () => {
      expect(AUTHZ_RESOURCES.secrets.actions).toContain("view");
    });
  });

  describe("given the ADMIN team role", () => {
    it("includes secrets:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "secrets:view")).toBe(
        true,
      );
    });

    it("includes secrets:manage permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "secrets:manage")).toBe(
        true,
      );
    });
  });

  describe("given the MEMBER team role", () => {
    it("includes secrets:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "secrets:view")).toBe(
        true,
      );
    });

    it("includes secrets:manage permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "secrets:manage")).toBe(
        true,
      );
    });
  });

  describe("given the VIEWER team role", () => {
    it("includes secrets:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "secrets:view")).toBe(
        true,
      );
    });

    it("does not include secrets:manage permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "secrets:manage")).toBe(
        false,
      );
    });
  });

  describe("given the CUSTOM fallback team role", () => {
    it("includes secrets:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.CUSTOM, "secrets:view")).toBe(
        true,
      );
    });

    it("does not include secrets:manage permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.CUSTOM, "secrets:manage")).toBe(
        false,
      );
    });
  });

  describe("given organization role permissions", () => {
    it("does not include any secrets permissions for ADMIN", () => {
      const permissions = getOrganizationRolePermissions(
        OrganizationUserRole.ADMIN,
      );
      const secretsPermissions = permissions.filter((p) =>
        p.startsWith("secrets:"),
      );
      expect(secretsPermissions).toHaveLength(0);
    });

    it("does not include any secrets permissions for MEMBER", () => {
      const permissions = getOrganizationRolePermissions(
        OrganizationUserRole.MEMBER,
      );
      const secretsPermissions = permissions.filter((p) =>
        p.startsWith("secrets:"),
      );
      expect(secretsPermissions).toHaveLength(0);
    });
  });

  describe("given the permissions UI configuration", () => {
    it("includes secrets in orderedResources", () => {
      expect(orderedResources).toContain("secrets");
    });

    it("returns view and manage as valid actions for secrets", () => {
      const actions = getValidActionsForResource("secrets");
      expect(actions).toContain("view");
      expect(actions).toContain("manage");
    });
  });

  describe("given the helper functions", () => {
    it("confirms canView returns true for all roles", () => {
      expect(canView(TeamUserRole.ADMIN, "secrets")).toBe(true);
      expect(canView(TeamUserRole.MEMBER, "secrets")).toBe(true);
      expect(canView(TeamUserRole.VIEWER, "secrets")).toBe(true);
    });

    it("confirms canManage returns true only for ADMIN and MEMBER", () => {
      expect(canManage(TeamUserRole.ADMIN, "secrets")).toBe(true);
      expect(canManage(TeamUserRole.MEMBER, "secrets")).toBe(true);
      expect(canManage(TeamUserRole.VIEWER, "secrets")).toBe(false);
    });
  });
});
