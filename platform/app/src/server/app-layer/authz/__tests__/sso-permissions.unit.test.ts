/** @vitest-environment node */

/**
 * The single sign-on permission split (D05 — see
 * specs/identity/sso-onboarding-tiers.feature).
 *
 * Real registry entries from the first day rather than a seam: `sso:view` and
 * `sso:manage` are declared in `packages/authz/src/registry.ts`, so what a
 * role may hold, what a grant may be scoped to, and what one permission
 * implies are all decided by the same data every other resource is decided
 * by.
 *
 * One pair, not two: the directory that provisions people is reached through
 * the connection it provisions against, and every directory-sync route gates
 * on these same two.
 */
import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  permissionSatisfiedBy,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { permissionFormatSchema } from "~/server/rbac/custom-role-permissions";

/** What an IT administrator's role holds, and nothing else. */
const IT_ADMIN_ROLE = new Set(["sso:view", "sso:manage"]);

describe("the single sign-on permissions", () => {
  describe("given a custom role holding only them, bound across the organization", () => {
    /** @scenario "A role holding only the single sign-on permissions can do only that" */
    it("satisfies single sign-on and directory provisioning, and nothing else the organization holds", () => {
      // The role is expressible: every permission in it is a valid
      // `resource:action` the custom-role write path accepts.
      for (const permission of IT_ADMIN_ROLE) {
        expect(permissionFormatSchema.safeParse(permission).success).toBe(true);
      }

      // It can set up and manage single sign-on and directory provisioning.
      for (const permission of IT_ADMIN_ROLE) {
        expect(
          permissionSatisfiedBy({
            granted: IT_ADMIN_ROLE,
            requested: permission,
          }),
        ).toBe(true);
      }

      // And nothing else the organization holds is readable or changeable by
      // somebody holding it — the whole registry, checked, not a sample.
      const reachable = ALL_PERMISSIONS.filter((permission) =>
        permissionSatisfiedBy({
          granted: IT_ADMIN_ROLE,
          requested: permission,
        }),
      );
      expect([...reachable].sort()).toEqual([...IT_ADMIN_ROLE].sort());
    });
  });

  describe("given somebody who may see single sign-on but not manage it", () => {
    /** @scenario "Seeing single sign-on and changing it are two different permissions" */
    it("reads the connection and is satisfied for nothing that changes it", () => {
      const viewer = new Set(["sso:view"]);

      // The connection, its domains and its state are readable.
      expect(
        permissionSatisfiedBy({ granted: viewer, requested: "sso:view" }),
      ).toBe(true);

      // Changing it is a different permission, and holding the read does not
      // imply it. The implication runs one way only: manage satisfies view,
      // which is what stops an administrator needing both granted.
      expect(
        permissionSatisfiedBy({ granted: viewer, requested: "sso:manage" }),
      ).toBe(false);
      expect(
        permissionSatisfiedBy({
          granted: new Set(["sso:manage"]),
          requested: "sso:view",
        }),
      ).toBe(true);
    });
  });

  describe("when a grant is attempted below the organization tier", () => {
    /** @scenario "The single sign-on permissions are granted across an organization or not at all" */
    it("refuses a team or project binding and accepts only an organization one", () => {
      for (const permission of IT_ADMIN_ROLE) {
        // A connection decides how EVERYONE in the organization signs in, so
        // a team- or project-scoped grant of it would have an
        // organization-wide blast radius under a label that said otherwise.
        expect(
          bindingScopeCanGrantPermission({ scopeType: "TEAM", permission }),
        ).toBe(false);
        expect(
          bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission }),
        ).toBe(false);
        expect(
          bindingScopeCanGrantPermission({
            scopeType: "ORGANIZATION",
            permission,
          }),
        ).toBe(true);
      }
    });
  });
});
