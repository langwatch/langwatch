/**
 * Which page key each personal-workspace screen answers, and what it is behind.
 *
 * Seven keys, and they are the contract with the route table. Two of them are
 * project-scoped, which is the thing worth stating out loud: `/:project/sessions`
 * and `/:project/pull-requests` are children of a layout route the host still
 * serves, and they belong to this family because their whole page bodies were
 * its tables.
 *
 * The refusal itself is `withUiPageGuard`'s and is proven in
 * `ui-page-guard.unit.test.tsx`; WHICH flag each page is behind is proven by
 * mounting the loaders in `personal-workspace-page-policy.integration.test.tsx`.
 * This file is the cheaper half: that the keys and the table agree at all.
 */

import { describe, expect, it } from "vitest";
import { personalWorkspacePageLoaders } from "../src/features/personal-workspace";
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
        expect(Object.keys(personalWorkspacePageLoaders)).toContain(key);
      }
    });

    it("registers the two project-scoped coding-agent keys the table names", () => {
      const tableKeys = uiRoutePageKeys(uiRouteTable);

      for (const key of PROJECT_KEYS) {
        expect(tableKeys).toContain(key);
        expect(Object.keys(personalWorkspacePageLoaders)).toContain(key);
      }
    });

    it("registers nothing the table does not name", () => {
      const tableKeys = new Set(uiRoutePageKeys(uiRouteTable));
      const stray = Object.keys(personalWorkspacePageLoaders).filter((key) => !tableKeys.has(key));

      expect(stray).toEqual([]);
    });

    it("leaves /me/devices to the table's redirect row", () => {
      expect(Object.keys(personalWorkspacePageLoaders)).not.toContain("pages/me/devices");
    });
  });

  describe("when a page is loaded", () => {
    it("hands back a component, so a navigation never resolves to nothing", async () => {
      const loader = personalWorkspacePageLoaders["pages/me/index"];

      const module = await loader!();

      expect(typeof module.default).toBe("function");
    });

    it("wraps the screen rather than returning it bare", async () => {
      const module = await personalWorkspacePageLoaders["pages/me/index"]!();

      // Every wrapper is named, and the order is the load-bearing part: the
      // host is outside the guard, so a refusal renders without one, and the
      // title is inside it, so a page that is not here never renames the tab.
      expect(module.default.displayName).toContain("withHost(PersonalWorkspaceHost");
      expect(module.default.displayName).toContain("withUiPageGuard");
    });
  });
});
