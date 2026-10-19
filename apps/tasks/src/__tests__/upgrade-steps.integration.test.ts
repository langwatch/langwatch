/**
 * The image's code step list, as the api and worker gates read it, against what the tasks process
 * collects over memory stores (coordinator ruling R1, 2026-10-08).
 * @vitest-environment node
 * @see specs/upgrade/serving-gate.feature
 */
import { readImageCodeSteps, servingImageTree } from "@langwatch/upgrade/gate";
import { describe, expect, it } from "vitest";

import { upgradeSteps } from "../upgrade-steps.ts";

describe("upgrade steps", () => {
  describe("when the tasks process lists the code steps its installed modules declare", () => {
    /** @scenario "The api and worker declare the code steps the tasks process collects" */
    it("names the ids, kinds and modes of the list the api and worker gate on, in order", async () => {
      let printed = "";
      await upgradeSteps({ args: ["--json"], write: (text) => (printed += text) });
      const collected: unknown = JSON.parse(printed);

      expect(collected).toEqual(readImageCodeSteps());
      expect(servingImageTree().codeSteps).toEqual(collected);
    }, 120_000);
  });
});
