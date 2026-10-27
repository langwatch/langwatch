/**
 * No-organization bouncer exemption list (inventory, people, costs, billed;
 * also retired addresses). Ported from platform/app test.
 */
import { describe, expect, it } from "vitest";

import { noOrgBouncerRoutes } from "../use-required-session.ts";

describe("the no-organization bouncer exemption list", () => {
  describe("when a session with no organization sits on an inventory-family address", () => {
    /** @scenario "The inventory family is exempt from the no-organization onboarding bouncer" */
    it("carries every new pattern in the exemption list", () => {
      expect(noOrgBouncerRoutes).toContain("/governance/inventory");
      expect(noOrgBouncerRoutes).toContain("/governance/inventory/[id]");
      expect(noOrgBouncerRoutes).toContain("/governance/people");
      expect(noOrgBouncerRoutes).toContain("/governance/costs");
      expect(noOrgBouncerRoutes).toContain("/governance/billed");
    });

    /** @scenario "The inventory family is exempt from the no-organization onboarding bouncer" */
    it("keeps the retired addresses exempt while their redirects mount", () => {
      expect(noOrgBouncerRoutes).toContain("/governance/catalog");
      expect(noOrgBouncerRoutes).toContain("/governance/catalog/[id]");
      expect(noOrgBouncerRoutes).toContain("/governance/ingestion-sources");
      expect(noOrgBouncerRoutes).toContain("/governance/ingestion-sources/[id]");
      expect(noOrgBouncerRoutes).toContain("/governance/tool-catalog");
      expect(noOrgBouncerRoutes).toContain("/governance/departments");
      expect(noOrgBouncerRoutes).toContain("/governance/cost-centers");
    });
  });

  describe("when a single sign-on test sign-in lands with no organization", () => {
    it("leaves the tester on the test landing rather than bouncing them to onboarding", () => {
      expect(noOrgBouncerRoutes).toContain("/auth/sso-test-complete");
    });
  });
});
