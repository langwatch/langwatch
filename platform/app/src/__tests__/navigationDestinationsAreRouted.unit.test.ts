/**
 * Every navigation destination the app declares must resolve to a real page.
 *
 * Spec: specs/navigation/destination-route-registration.feature
 *
 * The route table is hand-maintained, not filesystem routing, so adding a
 * page under `src/pages/` and linking to it are two edits — and the third,
 * registering the route, is the one nothing complains about. That is how the
 * Ops -> Migrations link shipped in #7079 pointing at a page nobody could open:
 * the page module and the menu entry both landed, the route entry did not, and
 * the link fell through to the catch-all.
 *
 * There are two ways to name a destination, and this covers both:
 *
 *   - The ops menu writes absolute `href="/ops/..."` literals in MainMenu.tsx.
 *   - Everything project-scoped goes through `projectRoutes`, which
 *     `PageMenuLink` turns into an href via `projectScopedDestination`. Those
 *     are data, so they are imported rather than scanned.
 *
 * The route table itself is data too, since it moved into `@langwatch/ui`: the
 * patterns are read off the descriptors rather than regexed out of a file.
 *
 * The first cut of this test checked only the literals while describing itself
 * as covering every link — so it shipped claiming 56 more destinations than it
 * actually looked at (#7113 review).
 *
 * "Resolves" has to mean what React Router means by it, not "matches some
 * pattern in the file". The table ends in a `*` route that renders the 404, so
 * every path on earth matches something; and `/ops` also matches `/:project`,
 * which is a different page entirely. `matchRoutes` applies the real ranking
 * and hands back the route that would actually render, which is the only
 * answer worth asserting on.
 */
import { uiRouteDescriptors, uiRouteTable } from "@langwatch/ui";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { projectRoutes } from "~/utils/routes";

const MAIN_MENU_PATH = path.join(__dirname, "../components/MainMenu.tsx");

/** The pattern the router falls back to when nothing else claims a path. */
const CATCH_ALL = "*";

/**
 * Stand-in for a dynamic segment's value. Any non-empty slug works — it only
 * has to be something the router can match a `:param` against.
 */
const SAMPLE_SEGMENT = "sample";

/** Absolute-path `href="..."` literals in the menu, in source order. */
function menuHrefLiterals(): string[] {
  const source = readFileSync(MAIN_MENU_PATH, "utf-8");
  return [...source.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!);
}

/**
 * Every path the route table declares, as a flat list. The real table nests,
 * but every path in it is absolute, so a flat list of the same strings ranks
 * identically — nesting only matters for joining relative segments. A layout
 * route declares no path of its own and contributes nothing here.
 */
function routePatterns(): string[] {
  return uiRouteDescriptors(uiRouteTable)
    .map((descriptor) => descriptor.path)
    .filter((declared): declared is string => declared !== void 0);
}

/** `projectRoutes` writes Next-style `[param]`; the router speaks `:param`. */
function toRouterPattern(declared: string): string {
  return declared.replace(/\[(\w+)\]/g, ":$1");
}

/** A concrete pathname a user could actually be on, for a declared path. */
function toSamplePathname(declared: string): string {
  return declared.replace(/\[\w+\]/g, SAMPLE_SEGMENT);
}

/**
 * Whether `resolved` is a wildcard route that deliberately owns `declared`'s
 * subtree — `/:project/simulations/*` is a sub-router, and every simulations
 * destination under it is meant to be served that way.
 *
 * This is the one place the strict check gives ground, so it gives as little as
 * possible: the wildcard's fixed prefix must be a real path prefix of the
 * destination. A typo inside a subtree a sub-router owns is therefore still
 * only caught by the not-the-404 assertion, which is the honest limit of what
 * a route table can tell us about a router it hands off to.
 */
function ownsSubtree({
  resolved,
  declared,
}: {
  resolved: string;
  declared: string;
}): boolean {
  if (!resolved.endsWith("/*")) return false;
  return declared.startsWith(`${resolved.slice(0, -2)}/`);
}

/** The pattern that would win for `pathname`, or null if nothing matched. */
function resolvedPattern({
  pathname,
  patterns,
}: {
  pathname: string;
  patterns: string[];
}): string | null {
  const matches = matchRoutes(
    patterns.map((pattern) => ({ path: pattern })),
    pathname,
  );
  return matches?.[0]?.route.path ?? null;
}

const patterns = routePatterns();
const hrefLiterals = menuHrefLiterals();
const declaredPaths = Object.values(projectRoutes).map((route) => route.path);

describe("given the destinations the app can navigate to", () => {
  // The menu links are still read as source literals, so a rename that stops
  // that regex matching would otherwise leave a test that passes by finding
  // nothing.
  it("finds the menu links, the declared routes, and the route table", () => {
    expect(hrefLiterals.length).toBeGreaterThanOrEqual(5);
    expect(declaredPaths.length).toBeGreaterThan(0);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
    expect(patterns).toContain(CATCH_ALL);
  });

  describe("when a menu link is resolved the way the router would", () => {
    /** @scenario "Every sidebar link opens a page" */
    it.each(hrefLiterals)("%s lands on a page, not the 404", (href) => {
      expect(resolvedPattern({ pathname: href, patterns })).not.toBe(CATCH_ALL);
    });

    /** @scenario "A sidebar link opens the page it names" */
    it.each(hrefLiterals)("%s resolves to its own route", (href) => {
      // A link that only resolves via `/:project` or `/@project/*` is pointing
      // at the project shell, which is not the page the label promises.
      expect(resolvedPattern({ pathname: href, patterns })).toBe(href);
    });
  });

  describe("when a declared destination is resolved the way the router would", () => {
    /** @scenario "Every declared navigation destination opens a page" */
    it.each(declaredPaths)("%s lands on a page, not the 404", (declared) => {
      const pathname = toSamplePathname(declared);
      expect(resolvedPattern({ pathname, patterns })).not.toBe(CATCH_ALL);
    });

    /** @scenario "A declared destination opens the page it names" */
    it.each(declaredPaths)("%s resolves to its own route", (declared) => {
      const pattern = toRouterPattern(declared);
      const resolved = resolvedPattern({
        pathname: toSamplePathname(declared),
        patterns,
      });
      const acceptable =
        resolved === pattern ||
        (resolved !== null && ownsSubtree({ resolved, declared: pattern }));
      expect(acceptable, `${declared} resolved to ${resolved}`).toBe(true);
    });
  });
});
