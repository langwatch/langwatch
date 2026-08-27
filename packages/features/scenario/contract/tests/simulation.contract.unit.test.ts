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
