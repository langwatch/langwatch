/**
 * `route-patterns.generated.json` must equal what the shell serves, so modules reading it
 * never see a stale list. Regenerate with UPDATE_ROUTE_PATTERNS=1.
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { uiRoutePatterns } from "../route-patterns";

const GENERATED_PATH = join(__dirname, "../route-patterns.generated.json");
const REGENERATE =
  "UPDATE_ROUTE_PATTERNS=1 VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/ui test src/shell/__tests__/route-patterns-are-current.unit.test.ts";

const serialised = (patterns: string[]): string => `${JSON.stringify(patterns, null, 2)}\n`;

describe("given the committed route-pattern list the modules bind against", () => {
  it("lists a catch-all and project routes", () => {
    const patterns = uiRoutePatterns();
    expect(patterns).toContain("*");
    expect(patterns.some((pattern) => pattern.startsWith("/:project/"))).toBe(true);
  });

  describe("when it is compared with the routes the shell registers", () => {
    it(`is current (regenerate with: ${REGENERATE})`, () => {
      if (process.env.UPDATE_ROUTE_PATTERNS === "1") {
        writeFileSync(GENERATED_PATH, serialised(uiRoutePatterns()));
      }
      const committed = JSON.parse(readFileSync(GENERATED_PATH, "utf-8")) as string[];
      expect(committed).toEqual(uiRoutePatterns());
    });
  });
});
