/**
 * Every navigation destination the app declares must resolve to a real page.
 * Spec: specs/navigation/destination-route-registration.feature
 */
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { projectNavItems } from "@langwatch/navigation-web/chrome";
import { uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

/** The pattern the router falls back to when nothing else claims a path. */
const CATCH_ALL = "*";

/** Stand-in for a dynamic segment's value, e.g. the project slug. */
const SAMPLE_SEGMENT = "sample";

/** `projectNavItems` writes Next-style `[param]`; the router speaks `:param`. */
function toRouterPattern(declared: string): string {
  return declared.replace(/\[(\w+)\]/g, ":$1");
}

/** A concrete pathname a user could actually be on, for a declared path. */
function toSamplePathname(declared: string): string {
  return declared.replace(/\[\w+\]/g, SAMPLE_SEGMENT);
}

/**
 * Whether `resolved` is a wildcard route that deliberately owns `declared`'s
 * subtree — a sub-router mount, where every destination under it is meant to
 * be served that way rather than by a route of its own.
 */
function ownsSubtree({ resolved, declared }: { resolved: string; declared: string }): boolean {
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

const patterns = uiRouteDescriptors(uiRouteTable)
  .map((descriptor) => descriptor.path)
  .filter((path): path is string => typeof path === "string");
const declaredPaths = Object.values(projectNavItems).map((item) => item.path);

describe("given the destinations the app can navigate to", () => {
  // Both readings are of hand-maintained tables, so a rename that stops one
  // matching would otherwise leave a test that passes by finding nothing.
  it("finds the declared destinations and the route table", () => {
    expect(declaredPaths.length).toBeGreaterThan(0);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
    expect(patterns).toContain(CATCH_ALL);
  });

  describe("when a sidebar link is resolved the way the router would", () => {
    /** @scenario Every sidebar link opens a page */
    it.each(declaredPaths)("%s lands on a page, not the 404", (declared) => {
      const pathname = toSamplePathname(declared);
      expect(resolvedPattern({ pathname, patterns })).not.toBe(CATCH_ALL);
    });

    /** @scenario A sidebar link opens the page it names */
    it.each(declaredPaths)("%s resolves to its own route", (declared) => {
      const pattern = toRouterPattern(declared);
      const pathname = toSamplePathname(declared);
      const resolved = resolvedPattern({ pathname, patterns });
      if (resolved === pattern) return;
      // A link that only resolves via a sub-router mount is pointing at that
      // workspace's own rail, which is not a page this table renders itself.
      expect(resolved && ownsSubtree({ resolved, declared: pattern })).toBe(true);
    });
  });

  describe("when a declared navigation destination is resolved the way the router would", () => {
    /** @scenario Every declared navigation destination opens a page */
    it.each(declaredPaths)("%s lands on a page, not the 404", (declared) => {
      const pathname = toSamplePathname(declared);
      expect(resolvedPattern({ pathname, patterns })).not.toBe(CATCH_ALL);
    });

    /** @scenario A declared destination opens the page it names */
    it.each(declaredPaths)("%s resolves to its own route", (declared) => {
      const pattern = toRouterPattern(declared);
      const pathname = toSamplePathname(declared);
      const resolved = resolvedPattern({ pathname, patterns });
      if (resolved === pattern) return;
      expect(resolved && ownsSubtree({ resolved, declared: pattern })).toBe(true);
    });
  });
});
