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

// Companion to rbac.secrets.test.ts — covers the auditLog:view permission
// added by the gateway audit consolidation. Verifies the perm is granted
// to all four team roles (so legacy admins falling back through TeamUser
// keep their /settings/audit-log access) and exposed in the custom-role
// permission picker UI as a read-only entry.

describe("AuditLog resource in RBAC", () => {
  describe("given the permission registry", () => {
    it("includes an AUDIT_LOG entry with value 'auditLog'", () => {
      expect(AUTHZ_RESOURCES.auditLog.actions).toContain("view");
    });
  });

  describe("given the ADMIN team role", () => {
    it("includes auditLog:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "auditLog:view")).toBe(
        true,
      );
    });
  });

  describe("given the MEMBER team role", () => {
    it("includes auditLog:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "auditLog:view")).toBe(
        true,
      );
    });
  });

  describe("given the VIEWER team role", () => {
    it("includes auditLog:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.VIEWER, "auditLog:view")).toBe(
        true,
      );
    });
  });

  describe("given the CUSTOM fallback team role", () => {
    it("includes auditLog:view permission", () => {
      expect(teamRoleHasPermission(TeamUserRole.CUSTOM, "auditLog:view")).toBe(
        true,
      );
    });
  });

  describe("given organization role permissions", () => {
    it("does not include any auditLog permissions on the org-role surface", () => {
      // auditLog:view flows through TeamUser / RoleBindings, not via the
      // OrganizationUser role enum (organization:* perms are the only
      // built-in org-role grants).
      const adminPerms = getOrganizationRolePermissions(
        OrganizationUserRole.ADMIN,
      );
      const memberPerms = getOrganizationRolePermissions(
        OrganizationUserRole.MEMBER,
      );
      expect(adminPerms.filter((p) => p.startsWith("auditLog:"))).toHaveLength(
        0,
      );
      expect(memberPerms.filter((p) => p.startsWith("auditLog:"))).toHaveLength(
        0,
      );
    });
  });

  describe("given the permissions UI configuration", () => {
    it("includes auditLog in orderedResources", () => {
      expect(orderedResources).toContain("auditLog");
    });

    it("exposes only :view as a valid action (audit log is read-only)", () => {
      const actions = getValidActionsForResource("auditLog");
      expect(actions).toEqual(["view"]);
    });
  });

  describe("given the helper functions", () => {
    it("confirms canView returns true for all team roles", () => {
      expect(canView(TeamUserRole.ADMIN, "auditLog")).toBe(true);
      expect(canView(TeamUserRole.MEMBER, "auditLog")).toBe(true);
      expect(canView(TeamUserRole.VIEWER, "auditLog")).toBe(true);
      // CUSTOM is the legacy-fallback bucket — covered explicitly so a
      // regression that only breaks CUSTOM doesn't slip past the suite.
      expect(canView(TeamUserRole.CUSTOM, "auditLog")).toBe(true);
    });
  });
});
