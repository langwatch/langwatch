/**
 * @vitest-environment jsdom
 *
 * The no-organization onboarding bouncer exempts a route by exact `.includes`
 * lookup over `noOrgBouncerRoutes`, matched against the bracket pattern
 * `resolvePathname` derives from ROUTE_PATTERNS (falling back to the raw
 * pathname when no pattern matches). A route missing from EITHER list loses
 * the exemption silently — a zero-organization session sitting on it gets
 * dumped on /onboarding/welcome. This pins both lists for the inventory
 * family (inventory, people, costs, billed), and keeps every retired
 * address exempt so its redirect route renders before the bouncer fires
 * (cost-centers precedent).
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { describe, expect, it, vi } from "vitest";

// The global test-setup stubs ~/utils/compat/next-router with an inert
// router; the pattern resolution is exactly what is under test here.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

import { noOrgBouncerRoutes } from "~/hooks/useRequiredSession";
import { resolvePathname } from "~/utils/compat/next-router";

describe("the no-organization bouncer exemption list", () => {
  describe("when a session with no organization sits on an inventory-family address", () => {
    /** @scenario The inventory family is exempt from the no-organization onboarding bouncer */
    it("recognizes every new pattern in both lists", () => {
      // Both lists: the exemption list carries the bracket patterns...
      expect(noOrgBouncerRoutes).toContain("/governance/inventory");
      expect(noOrgBouncerRoutes).toContain("/governance/inventory/[id]");
      expect(noOrgBouncerRoutes).toContain("/governance/people");
      expect(noOrgBouncerRoutes).toContain("/governance/costs");
      expect(noOrgBouncerRoutes).toContain("/governance/billed");

      // ...and ROUTE_PATTERNS must resolve a concrete detail address to the
      // exact pattern the list holds, or the `.includes` match misses.
      expect(resolvePathname("/governance/inventory/src_123")).toBe(
        "/governance/inventory/[id]",
      );
      expect(resolvePathname("/governance/inventory")).toBe(
        "/governance/inventory",
      );
      expect(resolvePathname("/governance/people")).toBe("/governance/people");
    });

    /** @scenario The inventory family is exempt from the no-organization onboarding bouncer */
    it("keeps the retired addresses exempt while their redirects mount", () => {
      expect(noOrgBouncerRoutes).toContain("/governance/catalog");
      expect(noOrgBouncerRoutes).toContain("/governance/catalog/[id]");
      expect(noOrgBouncerRoutes).toContain("/governance/ingestion-sources");
      expect(noOrgBouncerRoutes).toContain(
        "/governance/ingestion-sources/[id]",
      );
      expect(noOrgBouncerRoutes).toContain("/governance/tool-catalog");
      expect(noOrgBouncerRoutes).toContain("/governance/departments");
      expect(noOrgBouncerRoutes).toContain("/governance/cost-centers");

      // The retired detail addresses must still resolve to the bracket
      // patterns the list holds, or a zero-org session cold-loading an old
      // deep link bounces before the redirect renders.
      expect(resolvePathname("/governance/catalog/src_123")).toBe(
        "/governance/catalog/[id]",
      );
    });
  });
});
