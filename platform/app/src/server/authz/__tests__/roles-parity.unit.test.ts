/**
 * THE stage-A characterisation suite (ADR-092 migration stage A2): every
 * (role × permission) cell of the new role model must answer exactly like
 * the legacy bags in server/api/rbac.ts — hierarchy rules included. The
 * shadow rollout and every later stage stand on this suite being green.
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindingScopeCanGrant,
  EXTERNAL_MEMBER_PERMISSIONS,
  hasPermissionWithHierarchy,
  isDemoProject,
  organizationRoleHasPermission,
  type Permission,
  teamRoleHasPermission,
} from "../../api/rbac";
import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  permissionSatisfiedBy,
} from "../registry";
import {
  builtinRoleGrants,
  builtinRolePermissions,
  roleKeyForTeamRole,
} from "../roles";

describe("built-in role parity with legacy bags", () => {
  describe.each(
    Object.values(TeamUserRole),
  )("given team role %s", (teamRole) => {
    it("answers every registry permission exactly like the legacy bag", () => {
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          builtinRoleGrants({
            role: roleKeyForTeamRole(teamRole),
            permission,
          }) !== teamRoleHasPermission(teamRole, permission as Permission),
      );
      expect(mismatches).toEqual([]);
    });
  });

  describe.each([
    [OrganizationUserRole.ADMIN, "org-admin"] as const,
    [OrganizationUserRole.MEMBER, "org-member"] as const,
    [OrganizationUserRole.EXTERNAL, "org-member"] as const,
  ])("given organization role %s", (orgRole, builtinKey) => {
    it("answers every registry permission exactly like the legacy bag", () => {
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          builtinRoleGrants({ role: builtinKey, permission }) !==
          organizationRoleHasPermission(orgRole, permission as Permission),
      );
      expect(mismatches).toEqual([]);
    });
  });

  describe("given the lite-member bag", () => {
    it("matches EXTERNAL_MEMBER_PERMISSIONS with hierarchy", () => {
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          builtinRoleGrants({ role: "lite-member", permission }) !==
          hasPermissionWithHierarchy(EXTERNAL_MEMBER_PERMISSIONS, permission),
      );
      expect(mismatches).toEqual([]);
    });
  });

  describe("given the demo-viewer bag", () => {
    const originalDemoId = process.env.DEMO_PROJECT_ID;
    afterEach(() => {
      if (originalDemoId === undefined) delete process.env.DEMO_PROJECT_ID;
      else process.env.DEMO_PROJECT_ID = originalDemoId;
    });

    it("matches isDemoProject for every registry permission", () => {
      process.env.DEMO_PROJECT_ID = "demo-project-1";
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          builtinRolePermissions("demo-viewer").has(permission) !==
          isDemoProject("demo-project-1", permission as Permission),
      );
      expect(mismatches).toEqual([]);
    });
  });
});

describe("hierarchy rule parity", () => {
  const sampleSets: string[][] = [
    ["datasets:manage"],
    ["virtualKeys:manage"],
    ["gatewayGuardrails:manage"],
    ["traces:view", "traces:share"],
    ["organization:manage", "governance:manage"],
    [],
  ];

  describe.each(
    sampleSets.map((set) => [set.join(",") || "(empty)", set]),
  )("given granted set [%s]", (_label, granted) => {
    it("satisfies exactly the permissions the legacy helper satisfies", () => {
      const grantedSet = new Set(granted);
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          permissionSatisfiedBy({
            granted: grantedSet,
            requested: permission,
          }) !== hasPermissionWithHierarchy(granted, permission),
      );
      expect(mismatches).toEqual([]);
    });
  });
});

describe("scope fence parity (ADR-021)", () => {
  describe.each([
    "ORGANIZATION",
    "TEAM",
    "PROJECT",
  ] as const)("given a binding at %s scope", (scopeType) => {
    it("fences exactly the permissions the legacy fence fences", () => {
      const mismatches = ALL_PERMISSIONS.filter(
        (permission) =>
          bindingScopeCanGrantPermission({ scopeType, permission }) !==
          bindingScopeCanGrant(scopeType, permission as Permission),
      );
      expect(mismatches).toEqual([]);
    });
  });
});
