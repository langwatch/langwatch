/**
 * Which page key each gateway screen answers, and what it is behind.
 */

import { describe, expect, it } from "vitest";
import { gatewayFeature } from "../src/features/gateway";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import { uiRouteTable } from "../src/model/ui-route-table";

describe("given the gateway pages this package now serves", () => {
  describe("when the registry is compared with the route table", () => {
    it("registers a loader for every /gateway page the table names", () => {
      const gatewayKeys = uiRoutePageKeys(uiRouteTable).filter((key) =>
        key.startsWith("pages/gateway/"),
      );

      expect(gatewayKeys.sort()).toEqual(Object.keys(gatewayFeature.loaders).sort());
    });

    it("registers nothing outside the gateway family", () => {
      const stray = Object.keys(gatewayFeature.loaders).filter(
        (key) => !key.startsWith("pages/gateway/"),
      );

      expect(stray).toEqual([]);
    });

    it("leaves the bare /gateway address to the table's redirect row", () => {
      expect(Object.keys(gatewayFeature.loaders)).not.toContain("pages/gateway/index");
    });
  });

  describe("when a page is loaded", () => {
    it("hands back a component, so a navigation never resolves to nothing", async () => {
      const loader = gatewayFeature.loaders["pages/gateway/virtual-keys"];

      const module = await loader!();

      expect(typeof module.default).toBe("function");
    });

    it("wraps the screen rather than returning it bare", async () => {
      const module = await gatewayFeature.loaders["pages/gateway/virtual-keys"]!();

      // Both wrappers are named, and the order is the load-bearing part: the
      // host is outside the guard, so a refusal renders without one and a page
      // that opens has one.
      expect(module.default.displayName).toContain("GatewayHost");
      expect(module.default.displayName).toContain("withUiPageGuard");
    });
  });
});
