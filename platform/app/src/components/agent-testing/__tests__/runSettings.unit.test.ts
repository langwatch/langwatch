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

describe("the targets the run settings read", () => {
  describe("when the same agent ran on two sets of parameters", () => {
    /** @scenario "The repeat count counts the runs of each scenario and target key" */
    it("counts one run per scenario and target key, not per agent", () => {
      const settings = readRunSettings([
        run({
          targetReferenceId: "agent_1",
          targetType: "http",
          targetKey: "agent_1",
        }),
        {
          ...run({
            targetReferenceId: "agent_1",
            targetType: "http",
            targetKey: "agent_1#0123abcd",
            targetParameters: { model: "gpt-5-mini" },
          }),
          scenarioRunId: "run_b",
        },
      ]);

      expect(settings?.repeatCount).toBe(1);
    });
  });

  describe("when a target carries overrides over the run-level values", () => {
    /** @scenario "The Parameters row reads the run-level parameters alone" */
    it("reads the run-level parameters and leaves the target's own out", () => {
      const withParameters = run({
        targetReferenceId: "agent_1",
        targetType: "http",
        targetKey: "agent_1#0123abcd",
        targetParameters: { model: "gpt-5-mini" },
      });
      withParameters.metadata = {
        ...withParameters.metadata,
        parameters: { locale: "de", model: "gpt-5-mini" },
      } as never;

      const settings = readRunSettings([withParameters]);

      expect(settings?.parameters).toEqual([{ name: "locale", value: "de" }]);
    });
  });
});
