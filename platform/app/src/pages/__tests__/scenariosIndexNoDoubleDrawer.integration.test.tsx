/**
 * @vitest-environment jsdom
 *
 * Regression test for #3194: the Scenarios index page must NOT explicitly
 * render `<ScenarioFormDrawerFromUrl>` — the drawer is mounted globally
 * by `CurrentDrawer` via the drawer registry. Rendering it both ways
 * puts two `role="dialog"` elements in the DOM and breaks accessible
 * selectors / Playwright targeting.
 *
 * `CurrentDrawer.tsx` already emits a dev console warning when this
 * happens; this test pins the page-side fix into CI so the regression
 * cannot recur.
 *
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_PATH = join(
  process.cwd(),
  "src/pages/[project]/simulations/scenarios/index.tsx",
);

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

  describe("given the drawer registry", () => {
    it("still registers ScenarioFormDrawerFromUrl as the scenarioEditor drawer", async () => {
      const registry = await import("~/components/drawerRegistry");
      expect(registry.drawers).toHaveProperty("scenarioEditor");
      expect(registry.drawers.scenarioEditor.name).toBe(
        "ScenarioFormDrawerFromUrl",
      );
    });
  });
});
