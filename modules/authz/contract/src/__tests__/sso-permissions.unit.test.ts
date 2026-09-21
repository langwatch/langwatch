import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSIONS,
  authzPermissionSchema,
  bindingScopeCanGrantPermission,
  permissionSatisfiedBy,
} from "../registry.ts";
import { builtinRoleGrants } from "../roles.ts";

/**
 * The single sign-on permission split (D05, ADR-122 — see
 * specs/identity/sso-onboarding-tiers.feature). Real registry entries, so a
 * role, a grant's tier and one permission's implication are all one data set.
 */

/** What an IT administrator's role holds, and nothing else. */
const IT_ADMIN_ROLE = new Set(["sso:view", "sso:manage"]);

describe("given a custom role holding only the single sign-on permissions", () => {
  describe("when it is bound across the organization", () => {
    /** @scenario "A role holding only the single sign-on permissions can do only that" */
    it("reaches single sign-on and directory provisioning, and nothing else", () => {
      for (const permission of IT_ADMIN_ROLE) {
        expect(authzPermissionSchema.safeParse(permission).success).toBe(true);
        expect(permissionSatisfiedBy({ granted: IT_ADMIN_ROLE, requested: permission })).toBe(true);
      }

      // The whole registry, checked, not a sample.
      const reachable = ALL_PERMISSIONS.filter((permission) =>
        permissionSatisfiedBy({ granted: IT_ADMIN_ROLE, requested: permission }),
      );
      expect([...reachable].toSorted()).toEqual([...IT_ADMIN_ROLE].toSorted());
    });
  });
});

describe("given somebody who may see single sign-on but not manage it", () => {
  /** @scenario "Seeing single sign-on and changing it are two different permissions" */
  it("reads the connection and is satisfied for nothing that changes it", () => {
    const viewer = new Set(["sso:view"]);

    expect(permissionSatisfiedBy({ granted: viewer, requested: "sso:view" })).toBe(true);
    // The implication runs one way only, which is what stops an
    // administrator needing both granted.
    expect(permissionSatisfiedBy({ granted: viewer, requested: "sso:manage" })).toBe(false);
    expect(permissionSatisfiedBy({ granted: new Set(["sso:manage"]), requested: "sso:view" })).toBe(
      true,
    );
  });
});

describe("given a grant attempted below the organization tier", () => {
  /** @scenario "The single sign-on permissions are granted across an organization or not at all" */
  it("refuses a team or project binding and accepts only an organization one", () => {
    for (const permission of IT_ADMIN_ROLE) {
      // A connection decides how EVERYONE in the organization signs in, so a
      // team- or project-scoped grant would carry an organization-wide blast
      // radius under a label that said otherwise.
      expect(bindingScopeCanGrantPermission({ scopeType: "TEAM", permission })).toBe(false);
      expect(bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission })).toBe(false);
      expect(bindingScopeCanGrantPermission({ scopeType: "ORGANIZATION", permission })).toBe(true);
    }
  });
});

describe("given the organization administrator on a self-hosted installation", () => {
  /** @scenario "A role holding only the single sign-on permissions can do only that" */
  it("holds both permissions, because there is nobody else to hold them", () => {
    expect(builtinRoleGrants({ role: "org-admin", permission: "sso:view" })).toBe(true);
    expect(builtinRoleGrants({ role: "org-admin", permission: "sso:manage" })).toBe(true);
    expect(builtinRoleGrants({ role: "org-member", permission: "sso:view" })).toBe(false);
  });
});
