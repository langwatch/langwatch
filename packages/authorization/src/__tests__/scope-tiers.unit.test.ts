import { describe, expect, it } from "vitest";

import { ALL_PERMISSIONS } from "../registry.ts";
import {
  isDeclaredScopeTier,
  isOrgScopedPermission,
  isScopeTier,
  isStoredScopeTier,
  permissionGrantTiers,
} from "../scope-tiers.ts";

describe("the scope tier type guards", () => {
  describe("given an inherited Object.prototype key", () => {
    it("rejects it rather than narrowing it to a tier", () => {
      // `"constructor" in {}` and `"toString" in {}` are both true, so a
      // guard written with `in` would narrow these untrusted strings to a
      // tier whose table lookup then yields a function.
      for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
        expect(isScopeTier(key)).toBe(false);
        expect(isStoredScopeTier(key)).toBe(false);
        expect(isDeclaredScopeTier(key)).toBe(false);
      }
    });
  });

  describe("given a real member name", () => {
    it("accepts the tier spellings the table actually holds", () => {
      expect(isScopeTier("project")).toBe(true);
      expect(isScopeTier("organization")).toBe(true);
      expect(isDeclaredScopeTier("team")).toBe(true);
      expect(isDeclaredScopeTier("platform")).toBe(false);
    });
  });
});

describe("isOrgScopedPermission", () => {
  describe("given an organisation-tier-only permission", () => {
    it.each([
      "organization:view",
      "governance:view",
      "governance:manage",
      "ingestionSources:manage",
      "anomalyRules:view",
      "complianceExport:view",
      "activityMonitor:view",
      "webhookEndpoints:view",
      "webhookEndpoints:manage",
      "gatewaySpend:view",
      "gatewaySpend:manage",
      "aiTools:view",
      "aiTools:manage",
      "governanceCost:view",
    ] as const)("answers %s against the organization role", (permission) => {
      expect(isOrgScopedPermission(permission)).toBe(true);
    });

    /** @scenario Webhook management is an organization-scoped permission */
    it("answers webhook and spend management against the organization role", () => {
      expect(isOrgScopedPermission("webhookEndpoints:manage")).toBe(true);
      expect(isOrgScopedPermission("gatewaySpend:manage")).toBe(true);
    });
  });

  describe("given the registry", () => {
    it("answers exactly the permissions granted at the organization tier alone", () => {
      const registryOrgOnly = ALL_PERMISSIONS.filter((permission) => {
        const tiers = permissionGrantTiers(permission);
        return tiers.length === 1 && tiers[0] === "organization";
      });

      expect(ALL_PERMISSIONS.filter(isOrgScopedPermission)).toEqual(registryOrgOnly);
    });
  });

  describe("given a permission a project or team grants", () => {
    it.each(["analytics:view", "datasets:manage", "evaluations:view"] as const)(
      "does not answer %s against the organization role",
      (permission) => {
        expect(isOrgScopedPermission(permission)).toBe(false);
      },
    );
  });
});
