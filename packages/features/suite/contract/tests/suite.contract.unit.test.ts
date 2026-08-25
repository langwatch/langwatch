import { describe, expect, it } from "vitest";
import { suiteRunStateDataSchema, suiteTargetSchema } from "../src";

describe("Suite contract", () => {
  it("accepts prompt mappings", () => {
    expect(
      suiteTargetSchema.parse({
        type: "prompt",
        referenceId: "prompt_1",
        scenarioMappings: {
          question: { type: "source", sourceId: "scenario_1", path: ["input"] },
        },
      }),
    ).toMatchObject({ type: "prompt", referenceId: "prompt_1" });
  });

  it("rejects mappings for targets that do not support them", () => {
    expect(() =>
      suiteTargetSchema.parse({
        type: "workflow",
        referenceId: "workflow_1",
        scenarioMappings: {
          question: { type: "value", value: "hello" },
        },
      }),
    ).toThrow();
  });

  it("keeps the durable run state contract explicit", () => {
    expect(() => suiteRunStateDataSchema.parse({
      SuiteRunId: "run_1",
      BatchRunId: "batch_1",
      ScenarioSetId: "set_1",
      SuiteId: "suite_1",
      Status: "SUCCESS",
      Total: 1,
      StartedCount: 1,
      CompletedCount: 1,
      FailedCount: 0,
      Progress: 1,
      PassRateBps: 10000,
      CreatedAt: 1,
      UpdatedAt: 2,
      LastEventOccurredAt: 2,
      StartedAt: 1,
      FinishedAt: 2,
      PassedCount: 1,
      GradedCount: 1,
      extra: true,
    })).toThrow();
  });
});
