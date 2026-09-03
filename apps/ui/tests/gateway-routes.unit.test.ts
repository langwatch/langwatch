/**
 * Which page key each gateway screen answers, and what it is behind.
 *
 * The ten keys are the contract with the route table, and the permissions are
 * the policy that used to be spelled out at the bottom of each page file. Both
 * are easy to get subtly wrong in a way nothing else notices — a missing key
 * throws only when someone navigates, and a wrong grant either refuses a reader
 * the page admitted or admits one it refused — so both are stated here.
 *
 * The refusal itself is `withUiPageGuard`'s and is proven in
 * `ui-page-guard.unit.test.tsx`; WHICH grant each page asks it for is proven by
 * mounting the loaders in `gateway-page-policy.integration.test.tsx`. This file
 * is the cheaper half: that the keys and the table agree at all.
 */

import { describe, expect, it } from "vitest";
import { gatewayPageLoaders } from "../src/features/gateway";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import { uiRouteTable } from "../src/model/ui-route-table";

describe("given the gateway pages this package now serves", () => {
  describe("when the registry is compared with the route table", () => {
    it("registers a loader for every /gateway page the table names", () => {
      const gatewayKeys = uiRoutePageKeys(uiRouteTable).filter((key) =>
        key.startsWith("pages/gateway/"),
      );

      expect(gatewayKeys.sort()).toEqual(Object.keys(gatewayPageLoaders).sort());
    });

    it("registers nothing outside the gateway family", () => {
      const stray = Object.keys(gatewayPageLoaders).filter(
        (key) => !key.startsWith("pages/gateway/"),
      );

      expect(stray).toEqual([]);
    });

    it("leaves the bare /gateway address to the table's redirect row", () => {
      expect(Object.keys(gatewayPageLoaders)).not.toContain("pages/gateway/index");
    });
  });

  describe("when a page is loaded", () => {
    it("hands back a component, so a navigation never resolves to nothing", async () => {
      const loader = gatewayPageLoaders["pages/gateway/virtual-keys"];

      const module = await loader!();

      expect(typeof module.default).toBe("function");
    });

    it("wraps the screen rather than returning it bare", async () => {
      const module = await gatewayPageLoaders["pages/gateway/virtual-keys"]!();

      // Both wrappers are named, and the order is the load-bearing part: the
      // host is outside the guard, so a refusal renders without one and a page
      // that opens has one.
      expect(module.default.displayName).toContain("GatewayHost");
      expect(module.default.displayName).toContain("withUiPageGuard");
    });
  });
});
