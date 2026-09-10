import { describe, expect, it, vi } from "vitest";

import { createSimulationRunsRest, simulationRunErrorHandler } from "../simulation-run.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  PROJECT_ID,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

function buildSimulationRunsFamily(
  options: {
    findBatchSummary?: ReturnType<typeof vi.fn>;
    getRunDataForBatchRun?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const findBatchSummary = options.findBatchSummary ?? vi.fn(async () => null);
  const getRunDataForBatchRun = options.getRunDataForBatchRun ?? vi.fn();
  const world = createScenarioRestTestApp({
    simulations: { findBatchSummary, getRunDataForBatchRun },
  });
  const { runtime, projectFacts } = createScenarioRestTestRuntime();
  const declaration = createSimulationRunsRest({
    scenarioRunPlatformUrl: ({ projectSlug, scenarioRunId }) =>
      `https://app.langwatch.test/${projectSlug}/simulations/${scenarioRunId}`,
    findBatchSummary: (input) => world.simulations.findBatchSummary(input),
  });
  const mounted = runtime.mount(declaration.router(), {
    app: () => world.app,
    onError: simulationRunErrorHandler(scenarioRestTestErrors),
    facts: [projectFacts],
  });

  return {
    findBatchSummary,
    getRunDataForBatchRun,
    request: (path: string) => mounted.fetch(new Request(`http://api.test${path}`)),
  };
}

function batchSummary(overrides: Record<string, unknown> = {}) {
  return {
    batchRunId: "batch-a",
    totalCount: 2,
    passCount: 1,
    failCount: 0,
    runningCount: 1,
    settledCount: 1,
    stalledCount: 0,
    lastRunAt: 1,
    lastUpdatedAt: 2,
    firstCompletedAt: 1,
    allCompletedAt: null,
    note: null,
    startedBy: null,
    ...overrides,
  };
}

function run(scenarioRunId: string, batchRunId: string) {
  return {
    scenarioId: "scenario-a",
    batchRunId,
    scenarioRunId,
    name: "Checkout",
    description: "A checkout run",
    status: "SUCCESS" as const,
    metadata: {
      note: "nightly",
      langwatch: {
        targetReferenceId: "agent-a",
        targetType: "http" as const,
        scenarioVersion: 4,
      },
    },
    results: {
      verdict: "success" as const,
      reasoning: "all good",
      metCriteria: ["works"],
      unmetCriteria: [],
    },
    messages: [{ role: "assistant", content: "done" }],
    timestamp: 1,
    updatedAt: 2,
    durationInMs: 3,
    totalCost: 0.01,
  };
}

describe("the simulation-runs REST declaration", () => {
  describe("when a batch is requested by id", () => {
    /** @scenario "A batch summary is addressable by its batch run id" */
    it("serves all batch counts and the completion flag", async () => {
      const findBatchSummary = vi.fn(async () => batchSummary());
      const family = buildSimulationRunsFamily({ findBatchSummary });

      const response = await family.request("/api/simulation-runs/batches/batch-a");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        batchRunId: "batch-a",
        totalCount: 2,
        settledCount: 1,
        runningCount: 1,
        isComplete: false,
      });
      expect(findBatchSummary).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        batchRunId: "batch-a",
      });
    });

    /** @scenario "An unknown batch run id answers 404" */
    it("answers the legacy 404 body", async () => {
      const family = buildSimulationRunsFamily();

      const response = await family.request("/api/simulation-runs/batches/missing");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Batch run not found" });
    });
  });

  describe("when a batch id is the only list filter", () => {
    /** @scenario "A batch id alone filters the list" */
    it("asks for that batch and preserves the published run fields", async () => {
      const getRunDataForBatchRun = vi.fn(async () => ({
        changed: true as const,
        lastUpdatedAt: 2,
        runs: [run("run-a", "batch-a")],
      }));
      const family = buildSimulationRunsFamily({ getRunDataForBatchRun });

      const response = await family.request("/api/simulation-runs?batchRunId=batch-a");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        runs: [
          {
            scenarioId: "scenario-a",
            batchRunId: "batch-a",
            scenarioRunId: "run-a",
            name: "Checkout",
            description: "A checkout run",
            status: "SUCCESS",
            results: {
              verdict: "success",
              reasoning: "all good",
              metCriteria: ["works"],
              unmetCriteria: [],
            },
            messages: [{ role: "assistant", content: "done" }],
            timestamp: 1,
            updatedAt: 2,
            durationInMs: 3,
            totalCost: 0.01,
            note: "nightly",
            scenarioVersion: 4,
            platformUrl: "https://app.langwatch.test/scenario-rest-project/simulations/run-a",
          },
        ],
        hasMore: false,
      });
      expect(getRunDataForBatchRun).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        scenarioSetId: void 0,
        batchRunId: "batch-a",
      });
    });
  });
});
