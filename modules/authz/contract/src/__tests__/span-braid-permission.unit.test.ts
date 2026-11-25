/**
 * ADR-201 §3: `spans:braided` is minted onto a braid grant at proof time and never granted, so
 * no binding, built-in role, custom role or key confers it, at any tier.
 * Spec: modules/authz/specs/braids.feature
 */
import { SPAN_BRAID_PERMISSION } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { type BuiltinRoleKey, builtinRolePermissions, permissionsConferred } from "../roles.ts";
import { bindingScopeCanGrantPermission } from "../scope.ts";

const BUILTIN_ROLES: readonly BuiltinRoleKey[] = [
  "admin",
  "member",
  "viewer",
  "lite-member",
  "demo-viewer",
  "org-admin",
  "org-member",
  "platform-operator",
  "billing",
  "project-reader",
];

describe("the braid permission", () => {
  describe("given a binding at any tier", () => {
    /** @scenario "No role, custom role or API key may list the braid permission" */
    it.each(["ORGANIZATION", "TEAM", "PROJECT"] as const)("is never conferred from %s", (tier) => {
      expect(
        bindingScopeCanGrantPermission({ scopeType: tier, permission: SPAN_BRAID_PERMISSION }),
      ).toBe(false);
    });
  });

  describe("given every built-in role", () => {
    /** @scenario "No role, custom role or API key may list the braid permission" */
    it("lists it in none", () => {
      const holding = BUILTIN_ROLES.filter((role) =>
        builtinRolePermissions(role).has(SPAN_BRAID_PERMISSION),
      );

      expect(holding).toEqual([]);
    });
  });

  describe("given an organisation admin, who holds every other permission", () => {
    /** @scenario "No role, custom role or API key may list the braid permission" */
    it("confers it neither through the admin role nor through a custom role listing it", () => {
      const admin = permissionsConferred({
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        customPermissions: [],
      });
      const custom = permissionsConferred({
        role: "CUSTOM",
        scopeType: "PROJECT",
        customPermissions: ["traces:view", SPAN_BRAID_PERMISSION],
      });

      expect(admin).toContain("braids:manage");
      expect(admin).not.toContain(SPAN_BRAID_PERMISSION);
      expect(custom).toEqual(["traces:view"]);
    });
  });
});
