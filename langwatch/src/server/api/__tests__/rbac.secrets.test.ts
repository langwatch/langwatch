import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canManage,
  canView,
  getOrganizationRolePermissions,
  getTeamRolePermissions,
  Resources,
  teamRoleHasPermission,
} from "../rbac";
import {
  getValidActionsForResource,
  orderedResources,
} from "../../../utils/permissionsConfig";

describe("Secrets resource in RBAC", () => {
  describe("given the Resources enum", () => {
    it("includes a SECRETS entry with value 'secrets'", () => {
      expect(Resources.SECRETS).toBe("secrets");
    });
  });

  describe("given the ADMIN team role", () => {
    it("includes secrets:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.ADMIN, "secrets:view"),
      ).toBe(true);
    });

    it("includes secrets:manage permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.ADMIN, "secrets:manage"),
      ).toBe(true);
    });
  });

  describe("given the MEMBER team role", () => {
    it("includes secrets:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.MEMBER, "secrets:view"),
      ).toBe(true);
    });

    it("includes secrets:manage permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.MEMBER, "secrets:manage"),
      ).toBe(true);
    });
  });

  describe("given the VIEWER team role", () => {
    it("includes secrets:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.VIEWER, "secrets:view"),
      ).toBe(true);
    });

    it("does not include secrets:manage permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.VIEWER, "secrets:manage"),
      ).toBe(false);
    });
  });

  describe("given the CUSTOM fallback team role", () => {
    it("includes secrets:view permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.CUSTOM, "secrets:view"),
      ).toBe(true);
    });

    it("does not include secrets:manage permission", () => {
      expect(
        teamRoleHasPermission(TeamUserRole.CUSTOM, "secrets:manage"),
      ).toBe(false);
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
      expect(orderedResources).toContain(Resources.SECRETS);
    });

    it("returns view and manage as valid actions for secrets", () => {
      const actions = getValidActionsForResource(Resources.SECRETS);
      expect(actions).toContain("view");
      expect(actions).toContain("manage");
    });
  });

  describe("given the helper functions", () => {
    it("confirms canView returns true for all roles", () => {
      expect(canView(TeamUserRole.ADMIN, Resources.SECRETS)).toBe(true);
      expect(canView(TeamUserRole.MEMBER, Resources.SECRETS)).toBe(true);
      expect(canView(TeamUserRole.VIEWER, Resources.SECRETS)).toBe(true);
    });

    it("confirms canManage returns true only for ADMIN and MEMBER", () => {
      expect(canManage(TeamUserRole.ADMIN, Resources.SECRETS)).toBe(true);
      expect(canManage(TeamUserRole.MEMBER, Resources.SECRETS)).toBe(true);
      expect(canManage(TeamUserRole.VIEWER, Resources.SECRETS)).toBe(false);
    });
  });
});
