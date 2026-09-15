/**
 * Governance page guard moved from `organization:manage` to `governance:view`.
 * Assert against real built-in roles that nobody gets locked out (ADR-092).
 */
import { describe, expect, it } from "vitest";

import { permissionSatisfiedBy } from "../registry.ts";
import { type BuiltinRoleKey, builtinRoleGrants, builtinRolePermissions } from "../roles.ts";

const ALL_ROLE_KEYS: readonly BuiltinRoleKey[] = [
  "admin",
  "member",
  "viewer",
  "lite-member",
  "demo-viewer",
  "org-admin",
  "org-member",
];

describe("governance page guard permission", () => {
  describe("when every built-in role is checked", () => {
    /** @scenario "Widening the page guard locks nobody out" */
    it("grants governance:view to every role that can manage the organization", () => {
      // At least one role must actually hold `organization:manage`, or the
      // assertion below would pass by having nothing to check.
      const managers = ALL_ROLE_KEYS.filter((role) =>
        builtinRolePermissions(role).has("organization:manage"),
      );
      expect(managers.length).toBeGreaterThan(0);

      for (const role of managers) {
        expect(builtinRoleGrants({ role, permission: "governance:view" })).toBe(true);
      }
    });
  });

  describe("when the hierarchy rule is asked to bridge the two grants", () => {
    /** @scenario "A governance read grant does not imply organization management" */
    it("refuses in both directions", () => {
      expect(
        permissionSatisfiedBy({
          granted: new Set(["governance:view"]),
          requested: "organization:manage",
        }),
      ).toBe(false);
      expect(
        permissionSatisfiedBy({
          granted: new Set(["organization:manage"]),
          requested: "governance:view",
        }),
      ).toBe(false);

      // The rule it DOES apply, for contrast: manage implies view on the same
      // resource. This is why a `governance:manage` holder needs no second
      // grant to open the pages.
      expect(
        permissionSatisfiedBy({
          granted: new Set(["governance:manage"]),
          requested: "governance:view",
        }),
      ).toBe(true);
    });
  });
});
