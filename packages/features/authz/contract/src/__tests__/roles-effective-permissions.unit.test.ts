/**
 * The role -> permission grant table team-scoped role bindings resolve
 * against (specs/rbac/scoped-role-bindings.feature). `roleKeyForTeamRole`
 * maps a TeamUserRole onto the built-in role key `builtinRoleGrants` checks.
 */
import { describe, expect, it } from "vitest";

import { builtinRoleGrants, roleKeyForTeamRole } from "../roles";

describe("given a team role binding's effective permission grants", () => {
  describe.each([
    { role: "ADMIN", permission: "team:manage", result: true },
    { role: "MEMBER", permission: "team:manage", result: false },
    { role: "VIEWER", permission: "team:manage", result: false },
    { role: "ADMIN", permission: "analytics:view", result: true },
    { role: "MEMBER", permission: "analytics:view", result: true },
    { role: "VIEWER", permission: "analytics:view", result: true },
    { role: "MEMBER", permission: "datasets:manage", result: true },
    { role: "VIEWER", permission: "datasets:manage", result: false },
  ] as const)("when the role is $role and the permission is $permission", ({ role, permission, result }) => {
    /** @scenario "Effective role maps to correct permission grants" */
    it(`is ${result ? "granted" : "denied"}`, () => {
      const roleKey = roleKeyForTeamRole(role);
      expect(builtinRoleGrants({ role: roleKey, permission })).toBe(result);
    });
  });
});
