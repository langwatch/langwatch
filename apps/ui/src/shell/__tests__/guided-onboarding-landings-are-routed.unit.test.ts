/**
 * Where each guided path lands after sign-up must resolve to a route the table registers rather
 * than the catch-all. Tour-step addresses and Langy page names are not covered yet.
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import { installedModuleScreens } from "@langwatch/browser/module-screens";
import { GUIDED_PATHS, guidedPathLanding } from "@langwatch/onboarding-contract";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { browserModules } from "../../browser-modules.generated.ts";
import { uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

const CATCH_ALL = "*";

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

const landings = GUIDED_PATHS.map((path) => ({
  path,
  address: guidedPathLanding({ path, projectSlug: "sample" }),
}));

describe("given the address each guided path lands on after sign-up", () => {
  it("finds a landing for every path", () => {
    expect(landings).toHaveLength(GUIDED_PATHS.length);
  });

  describe("when each landing is resolved the way the router would resolve it", () => {
    it.each(landings)("$path lands on $address, a route of its own", ({ address }) => {
      expect(resolvedPattern(address)).not.toBeNull();
      expect(resolvedPattern(address)).not.toBe(CATCH_ALL);
    });
  });
});
