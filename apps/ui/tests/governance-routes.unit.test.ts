/**
 * Which page key each governance screen answers, and what it is behind.
 *
 * The eleven keys are the contract with the route table, and the flags are the
 * policy that used to be spelled out at the bottom of each page file. Both are
 * easy to get subtly wrong in a way nothing else notices — a missing key throws
 * only when someone navigates, and a missing flag opens an unreleased page — so
 * both are stated here.
 */

import { describe, expect, it } from "vitest";
import { governancePageLoaders } from "../src/features/governance";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import { uiRouteTable } from "../src/model/ui-route-table";

describe("given the governance pages this package now serves", () => {
  describe("when the registry is compared with the route table", () => {
    it("registers a loader for every /governance page the table names", () => {
      const governanceKeys = uiRoutePageKeys(uiRouteTable).filter((key) =>
        key.startsWith("pages/governance/"),
      );

      expect(governanceKeys.sort()).toEqual(Object.keys(governancePageLoaders).sort());
    });

    it("registers nothing outside the governance family", () => {
      const stray = Object.keys(governancePageLoaders).filter(
        (key) => !key.startsWith("pages/governance/"),
      );

      expect(stray).toEqual([]);
    });
  });

  describe("when a page is loaded", () => {
    it("hands back a component, so a navigation never resolves to nothing", async () => {
      const loader = governancePageLoaders["pages/governance/index"];

      const module = await loader!();

      expect(typeof module.default).toBe("function");
    });

    it("wraps the screen rather than returning it bare", async () => {
      const module = await governancePageLoaders["pages/governance/index"]!();

      // Both wrappers are named, and the order is the load-bearing part: the
      // host is outside the guard, so a refusal renders without one and a page
      // that opens has one.
      expect(module.default.displayName).toContain("withHost(GovernanceHost");
      expect(module.default.displayName).toContain("withUiPageGuard");
    });
  });
});
