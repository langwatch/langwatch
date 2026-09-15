/**
 * `feature-map.json`'s `platform.ui` addresses must resolve to a real route, the same
 * way a sidebar link must (`navigation-destinations-are-routed`).
 * Spec: specs/navigation/destination-route-registration.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

const CATCH_ALL = "*";
const PROJECT_INDEX = "/:project";
const FEATURE_MAP_PATH = join(__dirname, "../../../../../feature-map.json");

/** Every `surfaces.platform.ui` string in the feature catalogue. */
function featureMapUiAddresses(): string[] {
  const map = JSON.parse(readFileSync(FEATURE_MAP_PATH, "utf-8")) as unknown;
  const addresses: string[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const platform = (record.surfaces as Record<string, unknown> | undefined)?.platform as
      | Record<string, unknown>
      | undefined;
    if (typeof platform?.ui === "string") addresses.push(platform.ui);
    Object.values(record).forEach(visit);
  };

  visit(map);
  return addresses;
}

const patterns = uiRouteDescriptors(uiRouteTable)
  .map((descriptor) => descriptor.path)
  .filter((path): path is string => typeof path === "string");

/**
 * Whether `resolved` is a wildcard route that deliberately owns `declared`'s
 * subtree, mirroring `navigation-destinations-are-routed`'s own check.
 */
function ownsSubtree({ resolved, declared }: { resolved: string; declared: string }): boolean {
  if (!resolved.endsWith("/*")) return false;
  return declared.startsWith(`${resolved.slice(0, -2)}/`);
}

/** The pattern that would win for `pathname`, or null if nothing matched. */
function resolvedPattern(pathname: string): string | null {
  const matches = matchRoutes(
    patterns.map((pattern) => ({ path: pattern })),
    pathname,
  );
  return matches?.[0]?.route.path ?? null;
}

/**
 * Whether `declared` (a route table pattern, e.g. `/:project/traces`) is
 * actually the page the router would serve for it — not the catch-all, and
 * not the bare project-index route a single-segment address always matches.
 */
function isRegisteredFor(declared: string): boolean {
  const pathname = declared.replace(/:\w+/g, "sample");
  const resolved = resolvedPattern(pathname);
  if (resolved === null || resolved === CATCH_ALL) return false;
  if (resolved === declared) return true;
  return ownsSubtree({ resolved, declared });
}

describe("given feature-map.json's catalogue of features", () => {
  const addresses = featureMapUiAddresses();

  it("finds platform UI addresses to check", () => {
    expect(addresses.length).toBeGreaterThan(10);
  });

  describe("when each address is resolved the way the router would resolve it", () => {
    /** @scenario Every feature-map.json platform UI link opens a page */
    it.each(addresses)("%s lands on a page, not the 404", (address) => {
      // Catalogue addresses are project-relative unless they already match a
      // top-level route (/settings/*, /gateway/*, /governance/*, ...); a
      // match on the bare project-index route (":project" swallowing the
      // address as a slug) does not count as landing on a real page.
      const registeredAsTopLevel = isRegisteredFor(address);
      const registeredAsProjectScoped = isRegisteredFor(`${PROJECT_INDEX}${address}`);
      expect(registeredAsTopLevel || registeredAsProjectScoped).toBe(true);
    });
  });
});
