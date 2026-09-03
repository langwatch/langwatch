/**
 * The no-organization onboarding bouncer exempts a route by exact `.includes`
 * lookup over `noOrgBouncerRoutes`. A route missing from this list loses the
 * exemption silently — a zero-organization session sitting on it gets dumped
 * on /onboarding/welcome. This pins the list for the inventory family
 * (inventory, people, costs, billed), and keeps every retired address exempt
 * so its redirect route renders before the bouncer fires (cost-centers
 * precedent).
 *
 * Ported from `platform/app/src/__tests__/inventoryBouncerExemption.unit.test.ts`.
 * The original also drove `resolvePathname`/`ROUTE_PATTERNS`
 * (`~/utils/compat/next-router`), converting a concrete pathname like
 * `/governance/inventory/src_123` to the bracket pattern `noOrgBouncerRoutes`
 * holds before matching. That conversion has no successor here — grepping
 * the repo for `resolvePathname`/`ROUTE_PATTERNS` finds nothing outside this
 * comment — so only the list-membership half of the original scenario is
 * pinned below.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { describe, expect, it } from "vitest";

import { noOrgBouncerRoutes } from "../use-required-session";

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
});
