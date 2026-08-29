import { describe, expect, it } from "vitest";
import { simulationAllSuitesRunDataSchema, simulationRunDataSchema } from "../src";

describe("Simulation contract", () => {
  it("accepts a stored run while preserving provider-specific message fields", () => {
    const run = simulationRunDataSchema.parse({
      scenarioId: "scenario_1",
      batchRunId: "batch_1",
      scenarioRunId: "run_1",
      status: "SUCCESS",
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      messages: [{ role: "assistant", content: "done", tool_calls: [] }],
      timestamp: 1,
      durationInMs: 2,
    });

    expect(run.messages[0]).toMatchObject({ role: "assistant", tool_calls: [] });
  });

  /**
   * `ScenarioApp.queueSimulationRun` records the scenario version a run was
   * queued from under the reserved namespace, and the REST door answers it.
   * The namespace is a strict object, so a field it does not declare is
   * dropped here rather than at either end — which is what happened to this
   * one, leaving the API answering `scenarioVersion: null` for every run.
   */
  it("keeps the queued scenario version on the reserved namespace", () => {
    const run = simulationRunDataSchema.parse({
      scenarioId: "scenario_1",
      batchRunId: "batch_1",
      scenarioRunId: "run_1",
      status: "SUCCESS",
      messages: [],
      timestamp: 1,
      durationInMs: 2,
      metadata: {
        langwatch: {
          targetReferenceId: "prompt_1",
          targetType: "prompt",
          scenarioVersion: 4,
        },
      },
    });

    expect(run.metadata?.langwatch?.scenarioVersion).toBe(4);
  });

  it("keeps suite target metadata and the batch-to-set index in portable output", () => {
    const page = simulationAllSuitesRunDataSchema.parse({
      changed: true,
      lastUpdatedAt: 2,
      runs: [
        {
          scenarioId: "scenario_1",
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          status: "SUCCESS",
          messages: [],
          timestamp: 1,
          durationInMs: 2,
          metadata: {
            langwatch: {
              targetReferenceId: "workflow_1",
              targetType: "workflow",
            },
          },
        },
      ],
      scenarioSetIds: { batch_1: "suite_1" },
      hasMore: false,
    });

    if (!page.changed) throw new Error("Expected changed suite history page");

    expect(page.scenarioSetIds.batch_1).toBe("suite_1");
    expect(page.runs[0]?.metadata?.langwatch?.targetReferenceId).toBe("workflow_1");
  });
});
