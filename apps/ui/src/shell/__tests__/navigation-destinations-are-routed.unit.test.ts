/**
 * Every destination the menus name, written as a link or declared as data, must resolve to a
 * route the table registers rather than the catch-all.
 * Spec: specs/navigation/destination-route-registration.feature
 */
import { installedModuleScreens } from "@langwatch/browser/module-screens";
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { browserModules } from "../../browser-modules.generated.ts";
import { uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

const {
  cloudAdminGroup,
  gatewayNavItems,
  governanceNavItems,
  instanceGroup,
  opsGroup,
  projectNavItems,
} = await navigationWeb.installation.capabilities.chrome.load();

const CATCH_ALL = "*";
const PLACEHOLDER = "[project]";

const patterns = [
  ...uiRouteDescriptors(uiRouteTable).map((descriptor) => descriptor.path),
  ...installedModuleScreens(browserModules).routes.project.map((route) => route.path),
].filter((path): path is string => typeof path === "string");

/** The pattern that would win for `pathname`, or null if nothing matched. */
function resolvedPattern(pathname: string): string | null {
  const matches = matchRoutes(
    patterns.map((pattern) => ({ path: pattern })),
    pathname,
  );
  return matches?.[0]?.route.path ?? null;
}

/** Whether `resolved` is a wildcard route that owns `declared`'s subtree. */
function ownsSubtree({ resolved, declared }: { resolved: string; declared: string }): boolean {
  return resolved.endsWith("/*") && declared.startsWith(`${resolved.slice(0, -2)}/`);
}

/** The links the menus write directly, as absolute addresses. */
const writtenLinks = [
  ...[opsGroup(), instanceGroup(), cloudAdminGroup()].flatMap((group) =>
    group.items.map((item) => item.href),
  ),
  ...gatewayNavItems.map((item) => item.href),
  ...governanceNavItems.map((item) => item.href),
];

/** The destinations declared as data, with the project placeholder filled in. */
const declaredDestinations = Object.values(projectNavItems).map((item) => ({
  declared: item.path.replace(PLACEHOLDER, ":project"),
  address: item.path.replace(PLACEHOLDER, "sample"),
}));

describe("given the links the menus write directly", () => {
  it("finds links to check", () => {
    expect(writtenLinks.length).toBeGreaterThan(10);
  });

  describe("when each link is resolved the way the router would resolve it", () => {
    /** @scenario Every sidebar link opens a page */
    it.each(writtenLinks)("%s does not fall through to the catch-all", (link) => {
      expect(resolvedPattern(link)).not.toBe(CATCH_ALL);
      expect(resolvedPattern(link)).not.toBeNull();
    });

    /** @scenario A sidebar link opens the page it names */
    it.each(writtenLinks)("%s resolves to a route registered for that exact path", (link) => {
      expect(resolvedPattern(link)).toBe(link);
    });
  });
});

describe("given the destinations the application declares as data", () => {
  it("finds destinations to check", () => {
    expect(declaredDestinations.length).toBeGreaterThan(10);
  });

  describe("when each destination is resolved the way the router would resolve it", () => {
    /** @scenario Every declared navigation destination opens a page */
    it.each(declaredDestinations)(
      "$address does not fall through to the catch-all",
      ({ address }) => {
        expect(resolvedPattern(address)).not.toBe(CATCH_ALL);
        expect(resolvedPattern(address)).not.toBeNull();
      },
    );

    /** @scenario A declared destination opens the page it names */
    it.each(declaredDestinations)(
      "$address resolves to the route registered for its path",
      ({ declared, address }) => {
        const resolved = resolvedPattern(address);
        expect(resolved).not.toBeNull();
        expect(resolved === declared || ownsSubtree({ resolved: resolved ?? "", declared })).toBe(
          true,
        );
      },
    );
  });
});
