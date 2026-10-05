/**
 * Every absolute link the sidebar renders must resolve to a real page.
 *
 * Spec: specs/ops/ops-navigation-reachability.feature
 *
 * `routes.tsx` is a hand-maintained table, not filesystem routing, so adding a
 * page under `src/pages/` and linking to it from the menu is only two thirds of
 * the work — and the missing third is silent. That is how the Ops -> Migrations
 * link shipped in #7079 pointing at a page nobody could open: the page module
 * and the menu entry both landed, the route entry did not, and the link fell
 * through to the catch-all.
 *
 * Nothing else catches this. The page module typechecks, the href is just a
 * string, and no test rendered the menu and followed it.
 *
 * "Resolves" has to mean what React Router means by it, not "matches some
 * pattern in the file". The table ends in a `*` route that renders the 404
 * page, so every path on earth matches something; and `/ops` also matches
 * `/:project`, which is a different page entirely. `matchRoutes` applies the
 * real ranking and hands back the route that would actually render, which is
 * the only answer worth asserting on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

const MAIN_MENU_PATH = path.join(__dirname, "../components/MainMenu.tsx");
const ROUTES_PATH = path.join(__dirname, "../routes.tsx");

/** The pattern the router falls back to when nothing else claims a path. */
const CATCH_ALL = "*";

/** Absolute-path `href="..."` literals, in source order. */
function sidebarHrefs(): string[] {
  const source = readFileSync(MAIN_MENU_PATH, "utf-8");
  return [...source.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);
}

/**
 * Every `path: "..."` the route table declares, as a flat list. The real table
 * nests, but every path in it is absolute, so a flat list of the same strings
 * ranks identically — nesting only matters for joining relative segments.
 */
function routePatterns(): string[] {
  const source = readFileSync(ROUTES_PATH, "utf-8");
  return [...source.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/** The pattern that would win for `href`, or null if nothing matched at all. */
function resolvedPattern({
  href,
  patterns,
}: {
  href: string;
  patterns: string[];
}): string | null {
  const matches = matchRoutes(
    patterns.map((pattern) => ({ path: pattern })),
    href,
  );
  return matches?.[0]?.route.path ?? null;
}

describe("given the sidebar's absolute links", () => {
  const hrefs = sidebarHrefs();
  const patterns = routePatterns();

  // Both scans are regexes over source, so a rename that stops one matching
  // would otherwise leave a test that passes by finding nothing at all.
  it("finds the links and the route table", () => {
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
    expect(patterns).toContain(CATCH_ALL);
  });

  describe("when each link is resolved the way the router would", () => {
    /** @scenario "Every sidebar link opens a page" */
    it.each(hrefs)("%s lands on a page, not the 404", (href) => {
      expect(resolvedPattern({ href, patterns })).not.toBe(CATCH_ALL);
    });

    /** @scenario "A sidebar link opens the page it names" */
    it.each(hrefs)("%s resolves to its own route, not a wildcard", (href) => {
      // A link that only resolves via `/:project` or `/@project/*` is pointing
      // at the project shell, which is not the page the label promises.
      expect(resolvedPattern({ href, patterns })).toBe(href);
    });
  });
});
