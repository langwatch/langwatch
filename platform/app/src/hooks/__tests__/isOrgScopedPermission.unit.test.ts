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
      "aiTools:view",
      "aiTools:manage",
    ] as const)("routes %s against the organization role", (permission) => {
      expect(isOrgScopedPermission(permission)).toBe(true);
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
