/**
 * Langy mounts once per layout route; every route below a layout gets the panel.
 * Spec: specs/langy/langy-mount-scope.feature
 */
import { webModules } from "@langwatch/installed-web-modules";
import { installedModuleScreens } from "@langwatch/ui-kernel/module-screens";
import { describe, expect, it } from "vitest";

import { uiRouteTable, type UiRouteDescriptor } from "../ui-route-table";
import { uiUnservedPageLoaders } from "../ui-unserved-pages";

const LANGY_LAYOUT = "layouts/project-langy";
const APP_CHROME = "chrome";

/** How many routes carrying `layout` a path sits under in the descriptor table. */
function layoutAncestors({ path, layout }: { path: string; layout: string }): number | null {
  function walk(routes: readonly UiRouteDescriptor[], depth: number): number | null {
    for (const route of routes) {
      const isLayout =
        "layout" in route ? route.layout === layout : "page" in route && route.page === layout;
      const below = depth + (isLayout ? 1 : 0);
      if (route.path === path) return below;
      const children = "redirect" in route ? undefined : route.children;
      const found = children ? walk(children, below) : null;
      if (found !== null) return found;
    }
    return null;
  }

  return walk(uiRouteTable, 0);
}

const langyLayoutAncestors = (path: string) => layoutAncestors({ path, layout: LANGY_LAYOUT });

describe("given the application's route table", () => {
  describe("when the route for /cli/auth is matched", () => {
    /** @scenario The CLI device approval screen carries no assistant panel */
    it("sits under no Langy layout route", () => {
      expect(langyLayoutAncestors("/cli/auth")).toBe(0);
    });

    it("sits under exactly one Langy layout route for settings, proving the detector works", () => {
      expect(langyLayoutAncestors("/settings/members")).toBe(1);
    });
  });
});

describe("given a page a signed-out reader can open", () => {
  describe("when the shared-trace route is matched", () => {
    /**
     * The chrome mounts the navigation host, the header and the mode-driven
     * shell. A share page carries none of it: the reader has no workspace to
     * switch between and may not be signed in at all, so the page renders in a
     * plain frame and no navigation mode is ever consulted.
     *
     * @scenario A signed-out share page renders without the app chrome
     */
    it("sits under no application chrome, so no navigation mode is consulted", () => {
      expect(layoutAncestors({ path: "/share/:id", layout: APP_CHROME })).toBe(0);
      // The detector, proved against a page that IS inside the chrome.
      expect(layoutAncestors({ path: "/settings/members", layout: APP_CHROME })).toBe(1);
    });
  });
});

describe("given the installed web modules", () => {
  describe("when the Langy layout route's page key is resolved", () => {
    /**
     * A placeholder here drew the page with no panel above it, so an ask from
     * a dashboard board changed state that nothing rendered.
     *
     * @scenario The Langy layout route is served by the Langy module
     */
    it("is declared by the langy module, not held by a placeholder", () => {
      const screens = installedModuleScreens(webModules).loaders;

      expect(screens[LANGY_LAYOUT]).toBeTypeOf("function");
      expect(uiUnservedPageLoaders[LANGY_LAYOUT]).toBeUndefined();
      expect(langyLayoutAncestors("/:project/dashboards/:dashboardId")).toBe(1);
    });
  });
});
