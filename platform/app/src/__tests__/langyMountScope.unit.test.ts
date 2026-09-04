/**
 * @vitest-environment jsdom
 *
 * createBrowserRouter touches `document` while building the router, so this
 * file runs under jsdom even though it only matches paths, never renders.
 */
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { router } from "~/routes";

/**
 * Langy mounts once per layout route; every route below a layout gets the
 * panel. Special-purpose screens (the CLI device approval) must sit outside
 * it, or the panel draws itself over a screen whose only job is one
 * confirmation.
 *
 * Both Langy layouts are the route table's only PATHLESS page() routes: a
 * matched ancestor carrying `lazy` but no `path` is a Langy layout. The
 * root route is pathless too but carries `Component`, not `lazy`.
 *
 * Spec: specs/langy/langy-mount-scope.feature
 */

function langyLayoutAncestors(path: string): number {
  const matches = matchRoutes(router.routes, path);
  if (!matches) {
    return 0;
  }
  return matches.filter(
    (match) => !match.route.path && typeof match.route.lazy === "function",
  ).length;
}

describe("given the application's route table", () => {
  describe("when the route for /cli/auth is matched", () => {
    // @scenario "The CLI device approval screen carries no assistant panel"
    it("sits under no Langy layout route", () => {
      expect(matchRoutes(router.routes, "/cli/auth")).not.toBeNull();
      expect(langyLayoutAncestors("/cli/auth")).toBe(0);
    });
  });

  describe("when a settings route is matched", () => {
    // @scenario "The CLI device approval screen carries no assistant panel"
    it("sits under exactly one Langy layout route, proving the detector works", () => {
      expect(langyLayoutAncestors("/settings/members")).toBe(1);
    });
  });
});
