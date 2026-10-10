/** Surfaces open the run plan editor by its drawer name; the name must resolve to the editor. */

import { installedDrawerLoaders } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { scenarioWeb } from "../scenario.web.ts";
import { SuiteFormDrawer } from "../ui/sections/suites/suite-form-drawer.tsx";

describe("given a browser that installs scenario", () => {
  describe("when a surface opens the suiteEditor drawer", () => {
    /** @scenario "The run plan editor opens by its drawer name" */
    it("loads the run plan editor", async () => {
      const loaded = await installedDrawerLoaders([scenarioWeb]).suiteEditor?.();

      expect(loaded).toEqual({ default: SuiteFormDrawer });
    });
  });
});
