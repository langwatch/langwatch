/**
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { runHooksViewOf } from "../run-hooks.ts";

describe("runHooksViewOf()", () => {
  describe("given a finished run that recorded no hooks and has no known target type", () => {
    /** @scenario 'A run with no known target type offers no "Rerun and keep data" and is not marked "No hooks"' */
    it("is not marked No hooks", () => {
      const view = runHooksViewOf({
        metadata: { langwatch: { targetReferenceId: "agent_1" } },
        status: ScenarioRunStatus.SUCCESS,
      });

      expect(view.noHooks).toBe(false);
    });
  });
});
