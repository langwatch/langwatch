/**
 * Langy mounts once per layout route; every route below a layout gets the
 * panel. Special-purpose screens (the CLI device approval) must sit outside
 * it, or the panel draws itself over a screen whose only job is one
 * confirmation.
 *
 * Asserted against the DESCRIPTOR table rather than a built router: the table
 * is where the nesting is decided, and reading it needs no document.
 *
 * Spec: specs/langy/langy-mount-scope.feature
 */
import { describe, expect, it } from "vitest";
import { uiRouteTable, type UiRouteDescriptor } from "../src/model/ui-route-table";

const LANGY_LAYOUT = "features/langy/ProjectLangyLayout";
const APP_CHROME = "features/chrome/UiAppChrome";

/** How many routes carrying `layout` a path sits under in the descriptor table. */
function layoutAncestors({ path, layout }: { path: string; layout: string }): number | null {
  function walk(routes: readonly UiRouteDescriptor[], depth: number): number | null {
    for (const route of routes) {
      const isLayout = "page" in route && route.page === layout;
      const below = depth + (isLayout ? 1 : 0);
      if (route.path === path) return below;
      const found = route.children ? walk(route.children, below) : null;
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
