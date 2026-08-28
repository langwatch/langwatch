/**
 * Which model the run settings name. A run records the model it resolved and
 * the model its plan was configured with, and the settings block reads the one
 * the run really ran on.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */

import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { readRunSettings } from "../results/run-settings";

/** One finished run of a batch, carrying the reserved namespace given. */
function run(langwatch: Record<string, unknown>): ScenarioRunData {
  return {
    scenarioId: "scenario_refund",
    batchRunId: "batch_1",
    scenarioRunId: "run_a",
    status: ScenarioRunStatus.SUCCESS,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    metadata: { langwatch } as never,
  } as ScenarioRunData;
}

describe("the models the run settings read", () => {
  describe("when the run recorded the model it resolved", () => {
    /** @scenario "A run that recorded both models reads the resolved one" */
    it("reads the resolved model of each role", () => {
      const settings = readRunSettings([
        run({
          targetReferenceId: "agent_1",
          targetType: "http",
          judgeModel: "openai/gpt-5",
          resolvedSimulatorModel: "openai/gpt-5-mini",
          resolvedJudgeModel: "openai/gpt-5",
        }),
      ]);

      expect(settings?.simulatorModel).toBe("openai/gpt-5-mini");
      expect(settings?.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when the run was stored before the resolved models existed", () => {
    /** @scenario "A run stored before the resolved models existed reads its configured model" */
    it("falls back to the model its plan was configured with", () => {
      const settings = readRunSettings([
        run({
          targetReferenceId: "agent_1",
          targetType: "http",
          judgeModel: "openai/gpt-5",
        }),
      ]);

      expect(settings?.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("when the run recorded no model of either kind", () => {
    /** @scenario "A run that records neither model reads as none" */
    it("reads no model at all", () => {
      const settings = readRunSettings([
        run({ targetReferenceId: "agent_1", targetType: "http" }),
      ]);

      expect(settings?.simulatorModel).toBeNull();
      expect(settings?.judgeModel).toBeNull();
    });
  });
});
