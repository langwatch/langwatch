import { describe, expect, it } from "vitest";

import { simulationRunExecutionProcessStateSchema } from "../simulation-run-execution-data.process.ts";

describe("process state stored by the main release", () => {
  it("parses a run execution state as main stored it", () => {
    expect(
      simulationRunExecutionProcessStateSchema.parse({
        projectId: "p",
        scenarioRunId: "r",
        phase: "evaluating",
        queuedAtMs: 1,
        lastActivityAtMs: 2,
        cancelRequestedAtMs: null,
        finishedAtMs: 3,
        pendingEvaluators: [{ evaluatorId: "e", required: true }],
        evaluationsRecorded: false,
      }),
    ).toEqual({
      projectId: "p",
      scenarioRunId: "r",
      phase: "evaluating",
      queuedAtMs: 1,
      lastActivityAtMs: 2,
      cancelRequestedAtMs: null,
      finishedAtMs: 3,
      pendingEvaluators: [{ evaluatorId: "e", required: true }],
      evaluationsRecorded: false,
    });
  });
  it("fills the evaluation fields a first-release run execution state never stored", () => {
    expect(
      simulationRunExecutionProcessStateSchema.parse({
        projectId: "p",
        scenarioRunId: "r",
        phase: "running",
        queuedAtMs: 1,
        lastActivityAtMs: 2,
        cancelRequestedAtMs: null,
      }),
    ).toEqual({
      projectId: "p",
      scenarioRunId: "r",
      phase: "running",
      queuedAtMs: 1,
      lastActivityAtMs: 2,
      cancelRequestedAtMs: null,
      finishedAtMs: null,
      pendingEvaluators: null,
      evaluationsRecorded: false,
    });
  });
});
