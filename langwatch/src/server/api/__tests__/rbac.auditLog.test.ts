import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canView,
  getOrganizationRolePermissions,
  Resources,
  teamRoleHasPermission,
} from "../rbac";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../../utils/permissionsConfig";

// Companion to rbac.secrets.test.ts — covers the auditLog:view permission
// added by the gateway audit consolidation. Verifies the perm is granted
// to all four team roles (so legacy admins falling back through TeamUser
// keep their /settings/audit-log access) and exposed in the custom-role
// permission picker UI as a read-only entry.

describe("AuditLog resource in RBAC", () => {
  describe("given the Resources enum", () => {
    it("includes an AUDIT_LOG entry with value 'auditLog'", () => {
      expect(Resources.AUDIT_LOG).toBe("auditLog");
    });
  });

  describe("given the ADMIN team role", () => {
    it("includes auditLog:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.ADMIN, "auditLog:view"),
      ).toBe(true);
    });
  });

  describe("given the MEMBER team role", () => {
    it("includes auditLog:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.MEMBER, "auditLog:view"),
      ).toBe(true);
    });
  });

  describe("given the VIEWER team role", () => {
    it("includes auditLog:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.VIEWER, "auditLog:view"),
      ).toBe(true);
    });
  });

  describe("given the CUSTOM fallback team role", () => {
    it("includes auditLog:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.CUSTOM, "auditLog:view"),
      ).toBe(true);
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
      expect(orderedResources).toContain(Resources.AUDIT_LOG);
    });

    it("exposes only :view as a valid action (audit log is read-only)", () => {
      const actions = getValidActionsForResource(Resources.AUDIT_LOG);
      expect(actions).toEqual(["view"]);
    });
  });

  describe("given the helper functions", () => {
    it("confirms canView returns true for all team roles", () => {
      expect(canView(TeamUserRole.ADMIN, Resources.AUDIT_LOG)).toBe(true);
      expect(canView(TeamUserRole.MEMBER, Resources.AUDIT_LOG)).toBe(true);
      expect(canView(TeamUserRole.VIEWER, Resources.AUDIT_LOG)).toBe(true);
    });
  });
});
