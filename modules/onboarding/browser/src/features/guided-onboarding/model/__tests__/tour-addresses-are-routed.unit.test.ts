import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GUIDED_PATHS, guidedPathLanding } from "@langwatch/onboarding-contract";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { TOUR_STEPS, type TourStepContext } from "../tour-steps.ts";

const CATCH_ALL = "*";
const ROUTE_PATTERNS_PATH = join(
  __dirname,
  "../../../../../../../../apps/ui/src/shell/route-patterns.generated.json",
);

const patterns = JSON.parse(readFileSync(ROUTE_PATTERNS_PATH, "utf-8")) as string[];

/** The pattern that would win for `address`, or null when nothing matched. */
function resolvedPattern(address: string): string | null {
  const matches = matchRoutes(
    patterns.map((pattern) => ({ path: pattern })),
    address,
  );
  return matches?.[0]?.route.path ?? null;
}

/** Every address a path's steps navigate to, collected by running each step's hooks. */
function navigatedAddresses(path: (typeof GUIDED_PATHS)[number]): string[] {
  const addresses: string[] = [];
  const ctx: TourStepContext = { navigate: (to) => addresses.push(to), actions: {} };
  for (const step of TOUR_STEPS[path]) {
    void step.before?.(ctx);
    void step.onArrive?.(ctx);
  }
  return addresses;
}

const landings = GUIDED_PATHS.map((path) => ({
  path,
  address: guidedPathLanding({ path, projectSlug: "sample" }),
}));

const stepAddresses = GUIDED_PATHS.flatMap((path) =>
  navigatedAddresses(path).map((address) => ({ path, address })),
);

describe("given the shell's committed route patterns", () => {
  it("lists the catch-all, so a fall-through is detectable", () => {
    expect(patterns).toContain(CATCH_ALL);
  });

  describe("when the addresses the guided onboarding navigates to are matched", () => {
    it("finds a landing for every path", () => {
      expect(landings).toHaveLength(GUIDED_PATHS.length);
    });

    /** @scenario every address the guided onboarding navigates to is a registered route */
    it.each(landings)("$path lands on $address, a route of its own", ({ address }) => {
      expect(resolvedPattern(address)).not.toBeNull();
      expect(resolvedPattern(address)).not.toBe(CATCH_ALL);
    });

    it("finds at least one address a tour step navigates to", () => {
      expect(stepAddresses.length).toBeGreaterThan(0);
    });

    /** @scenario every address the guided onboarding navigates to is a registered route */
    it.each(stepAddresses)(
      "the $path tour step to $address is a route of its own",
      ({ address }) => {
        expect(resolvedPattern(address)).not.toBeNull();
        expect(resolvedPattern(address)).not.toBe(CATCH_ALL);
      },
    );
  });
});
