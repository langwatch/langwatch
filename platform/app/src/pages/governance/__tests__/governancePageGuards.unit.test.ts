/**
 * The Governance page guards ask for `governance:view`, the same grant the
 * product switcher and the legacy Govern menu offer the product on. They used
 * to ask for `organization:manage`.
 *
 * The two are DISJOINT under the hierarchy rule — `<resource>:manage` implies
 * only `<resource>:view` for the same resource — so the swap is not a pure
 * widening, and this file is what makes it safe: it asserts against the real
 * role tables that nobody who could open a Governance page before is locked
 * out now.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { describe, expect, it } from "vitest";

import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import {
  hasPermissionWithHierarchy,
  organizationRoleHasPermission,
  teamRoleHasPermission,
} from "~/server/api/rbac";

describe("governance page guard permission", () => {
  describe("when every built-in role is checked", () => {
    /** @scenario "Widening the page guard locks nobody out" */
    it("grants governance:view to every role that can manage the organization", () => {
      const organizationRoles = Object.values(OrganizationUserRole);
      const teamRoles = Object.values(TeamUserRole);

      // At least one role must actually hold `organization:manage`, or the
      // assertion below would pass by having nothing to check.
      const managers = organizationRoles.filter((role) =>
        organizationRoleHasPermission(role, "organization:manage"),
      );
      expect(managers.length).toBeGreaterThan(0);

      for (const role of managers) {
        expect(organizationRoleHasPermission(role, "governance:view")).toBe(true);
      }

      // Team roles resolve their own bag. None of them holds
      // `organization:manage` (it is organization-scoped), so none of them
      // could open a Governance page before either.
      for (const role of teamRoles) {
        if (teamRoleHasPermission(role, "organization:manage")) {
          expect(teamRoleHasPermission(role, "governance:view")).toBe(true);
        }
      }
    });
  });

  describe("when the hierarchy rule is asked to bridge the two grants", () => {
    /** @scenario "A governance read grant does not imply organization management" */
    it("refuses in both directions", () => {
      expect(hasPermissionWithHierarchy(["governance:view"], "organization:manage")).toBe(
        false,
      );
      expect(hasPermissionWithHierarchy(["organization:manage"], "governance:view")).toBe(
        false,
      );

      // The rule it DOES apply, for contrast: manage implies view on the same
      // resource. This is why a `governance:manage` holder needs no second
      // grant to open the pages.
      expect(hasPermissionWithHierarchy(["governance:manage"], "governance:view")).toBe(
        true,
      );
    });
  });
});
