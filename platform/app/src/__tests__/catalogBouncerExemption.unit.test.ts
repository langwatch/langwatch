/**
 * @vitest-environment jsdom
 *
 * The no-organization onboarding bouncer exempts a route by exact `.includes`
 * lookup over `noOrgBouncerRoutes`, matched against the bracket pattern
 * `resolvePathname` derives from ROUTE_PATTERNS (falling back to the raw
 * pathname when no pattern matches). A route missing from EITHER list loses
 * the exemption silently — a zero-organization session sitting on it gets
 * dumped on /onboarding/welcome. This pins both lists for the catalog, and
 * keeps the retired ingestion-sources entries so the redirect route renders
 * before the bouncer fires (cost-centers precedent).
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
  describe("when a session with no organization sits on a catalog address", () => {
    /** @scenario The catalog is exempt from the no-organization onboarding bouncer */
    it("recognizes both catalog patterns and keeps the retired entries", () => {
      // Both lists: the exemption list carries the bracket patterns...
      expect(noOrgBouncerRoutes).toContain("/governance/catalog");
      expect(noOrgBouncerRoutes).toContain("/governance/catalog/[id]");

      // ...and ROUTE_PATTERNS must resolve a concrete detail address to the
      // exact pattern the list holds, or the `.includes` match misses.
      expect(resolvePathname("/governance/catalog/src_123")).toBe(
        "/governance/catalog/[id]",
      );
      expect(resolvePathname("/governance/catalog")).toBe(
        "/governance/catalog",
      );

      // The retired addresses stay exempt while the redirect route mounts.
      expect(noOrgBouncerRoutes).toContain("/governance/ingestion-sources");
      expect(noOrgBouncerRoutes).toContain(
        "/governance/ingestion-sources/[id]",
      );
    });
  });
});
