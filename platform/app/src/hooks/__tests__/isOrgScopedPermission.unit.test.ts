import { ALL_PERMISSIONS, permissionGrantTiers } from "@langwatch/authz";
import { describe, expect, it } from "vitest";

import { isOrgScopedPermission } from "../useOrganizationTeamProject";

describe("isOrgScopedPermission", () => {
  describe("given an org-scoped permission", () => {
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
    ] as const)("routes %s against the organization role", (permission) => {
      expect(isOrgScopedPermission(permission)).toBe(true);
    });

    /** @scenario Webhook management is an organization-scoped permission */
    it("routes webhook and spend permissions against the org role", () => {
      expect(isOrgScopedPermission("webhookEndpoints:manage")).toBe(true);
      expect(isOrgScopedPermission("gatewaySpend:manage")).toBe(true);
    });

    // Regression: the /me portal admin getting-started banner gates on
    // hasPermission("aiTools:manage"). aiTools lives in
    // ORGANIZATION_ROLE_PERMISSIONS, not any team-role bag, so a fresh-org
    // admin (whose only membership is a built-in team ADMIN role) must resolve
    // it against the org role. When aiTools was team-routed the admin fell
    // through to the member "your admin hasn't added any tools" empty-state.
    it("treats aiTools:manage as org-scoped so admins see the getting-started banner", () => {
      expect(isOrgScopedPermission("aiTools:manage")).toBe(true);
    });

    // Regression: the governance Costs screen gates on
    // withPermissionGuard("governanceCost:view"). The resource is
    // org-exclusive on the server (the authz registry declares it) and is
    // granted only in the org ADMIN bags, so team-routing it denied the
    // screen to every org admin while the router allowed them.
    it("treats governanceCost:view as org-scoped so org admins can open Costs", () => {
      expect(isOrgScopedPermission("governanceCost:view")).toBe(true);
    });
  });

  // The prefix list inside isOrgScopedPermission is hand-kept, and the
  // registry is the only place that records which tiers a permission may be
  // granted at. Every time the two disagree the client denies a screen the
  // server allows — that is how governanceCost:view shipped broken, and
  // aiTools:manage before it. This walks the whole registry so the next
  // org-tier resource fails here instead of in front of an admin.
  describe("given the authz registry", () => {
    // No @scenario: this pins an implementation invariant — the hook's list
    // against the registry — not a behaviour a reader of the spec would
    // recognize. The behaviours it protects are the cases above.
    it("routes exactly the org-tier-only permissions against the org role", () => {
      const registryOrgOnly: string[] = [];
      const hookOrgScoped: string[] = [];

      for (const permission of ALL_PERMISSIONS) {
        const tiers = permissionGrantTiers(permission);
        if (tiers.length === 1 && tiers[0] === "organization") {
          registryOrgOnly.push(permission);
        }
        if (isOrgScopedPermission(permission)) {
          hookOrgScoped.push(permission);
        }
      }

      expect(hookOrgScoped.sort()).toEqual(registryOrgOnly.sort());
    });
  });

  describe("given a team-scoped permission", () => {
    it.each([
      "analytics:view",
      "datasets:manage",
      "evaluations:view",
    ] as const)("does not route %s against the organization role", (permission) => {
      expect(isOrgScopedPermission(permission)).toBe(false);
    });
  });
});
