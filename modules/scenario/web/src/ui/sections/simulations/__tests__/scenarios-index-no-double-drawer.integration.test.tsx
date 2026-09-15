/**
 * Regression #3194: page must not render <ScenarioFormDrawerFromUrl> — it's mounted globally.
 * @vitest-environment jsdom
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_PATH = join(process.cwd(), "src/ui/sections/simulations/scenario-library.screen.tsx");

describe("Scenarios index page (regression #3194)", () => {
  describe("given the page module source", () => {
    /** @scenario "I'll write it myself" leaves exactly one Create Scenario drawer in the DOM */
    it("does not import ScenarioFormDrawerFromUrl", () => {
      const source = readFileSync(PAGE_PATH, "utf-8");
      // The drawer should be mounted via CurrentDrawer/drawer registry only.
      // An import here is a code smell — it likely means a duplicate render
      // is being introduced (the bug pattern from #3194).
      expect(source).not.toMatch(/^import .*ScenarioFormDrawerFromUrl/m);
    });

    /** @scenario ScenarioFormDrawerFromUrl is not rendered both explicitly and via the drawer registry */
    it("does not render <ScenarioFormDrawerFromUrl> in JSX", () => {
      const source = readFileSync(PAGE_PATH, "utf-8");
      expect(source).not.toMatch(/<ScenarioFormDrawerFromUrl\b/);
    });
  });

  describe("given what this package publishes for the drawer registry", () => {
    /**
     * The registry is the composing app's now — this package only publishes drawer
     * COMPONENTS — so the test can just check the `scenarioEditor` address still
     * resolves to the component the page must not also mount.
     */
    it("still publishes ScenarioFormDrawerFromUrl for the scenarioEditor address", () => {
      const source = readFileSync(join(process.cwd(), "src/drawers.ts"), "utf-8");
      expect(source).toMatch(/export \{ ScenarioFormDrawerFromUrl \}/);
    });
  });
});
