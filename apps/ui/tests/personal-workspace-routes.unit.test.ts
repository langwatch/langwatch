/**
 * Which page key each personal-workspace screen answers, and what it is behind.
 */

import { describe, expect, it } from "vitest";
import { personalWorkspaceFeature } from "../src/features/personal-workspace";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import { uiRouteTable } from "../src/model/ui-route-table";

const PERSONAL_KEYS = [
  "pages/me/index",
  "pages/me/configure",
  "pages/me/sessions",
  "pages/me/pull-requests",
  "pages/me/budget/request",
];

const PROJECT_KEYS = ["pages/[project]/sessions", "pages/[project]/pull-requests"];

describe("given the personal-workspace pages this package now serves", () => {
  describe("when the registry is compared with the route table", () => {
    it("registers a loader for every /me page the table names", () => {
      const meKeys = uiRoutePageKeys(uiRouteTable).filter((key) => key.startsWith("pages/me/"));

      expect(meKeys.sort()).toEqual(PERSONAL_KEYS.sort());
      for (const key of PERSONAL_KEYS) {
        expect(Object.keys(personalWorkspaceFeature.loaders)).toContain(key);
      }
    });

    it("registers the two project-scoped coding-agent keys the table names", () => {
      const tableKeys = uiRoutePageKeys(uiRouteTable);

      for (const key of PROJECT_KEYS) {
        expect(tableKeys).toContain(key);
        expect(Object.keys(personalWorkspaceFeature.loaders)).toContain(key);
      }
    });

    it("registers nothing the table does not name", () => {
      const tableKeys = new Set(uiRoutePageKeys(uiRouteTable));
      const stray = Object.keys(personalWorkspaceFeature.loaders).filter(
        (key) => !tableKeys.has(key),
      );

      expect(stray).toEqual([]);
    });

    it("leaves /me/devices to the table's redirect row", () => {
      expect(Object.keys(personalWorkspaceFeature.loaders)).not.toContain("pages/me/devices");
    });
  });

  describe("when a page is loaded", () => {
    it("hands back a component, so a navigation never resolves to nothing", async () => {
      const loader = personalWorkspaceFeature.loaders["pages/me/index"];

      const module = await loader!();

      expect(typeof module.default).toBe("function");
    });

    it("wraps the screen rather than returning it bare", async () => {
      const module = await personalWorkspaceFeature.loaders["pages/me/index"]!();

      // Every wrapper is named, and the order is the load-bearing part: the
      // host is outside the guard, so a refusal renders without one, and the
      // title is inside it, so a page that is not here never renames the tab.
      expect(module.default.displayName).toContain("withHost(PersonalWorkspaceHost");
      expect(module.default.displayName).toContain("withUiPageGuard");
    });
  });
});
