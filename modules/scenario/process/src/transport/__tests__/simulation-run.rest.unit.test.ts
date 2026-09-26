import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { SimulationRunStatus, SimulationVerdict } from "@langwatch/scenario-contract";
import type { SimulationRunData, SimulationService } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { createSimulationRunsRest } from "../simulation-run.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  ORGANIZATION_ID,
  PROJECT_ID,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

async function buildSimulationRunsFamily(
  options: {
    findBatchSummary?: SimulationService["findBatchSummary"];
    getRunDataForBatchRun?: SimulationService["getRunDataForBatchRun"];
    getRunDataForScenarioSet?: SimulationService["getRunDataForScenarioSet"];
    featureFlags?: Partial<FeatureFlagApi>;
  } = {},
) {
  const findBatchSummary =
    options.findBatchSummary ?? vi.fn<SimulationService["findBatchSummary"]>();
  const getRunDataForBatchRun =
    options.getRunDataForBatchRun ?? vi.fn<SimulationService["getRunDataForBatchRun"]>();
  const getRunDataForScenarioSet =
    options.getRunDataForScenarioSet ?? vi.fn<SimulationService["getRunDataForScenarioSet"]>();
  const world = await createScenarioRestTestApp({
    simulations: { findBatchSummary, getRunDataForBatchRun, getRunDataForScenarioSet },
    featureFlags: options.featureFlags,
  });
  const { runtime, projectFacts } = createScenarioRestTestRuntime();
  const declaration = createSimulationRunsRest();
  const mounted = runtime.mount(declaration.router(), {
    app: () => world.app,
    onError: scenarioRestTestErrors,
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

function run(scenarioRunId: string, batchRunId: string): SimulationRunData {
  return {
    scenarioId: "scenario-a",
    batchRunId,
    scenarioRunId,
    name: "Checkout",
    description: "A checkout run",
    status: SimulationRunStatus.SUCCESS,
    metadata: {
      note: "nightly",
      langwatch: {
        targetReferenceId: "agent-a",
        targetType: "http" as const,
        scenarioVersion: 4,
      },
    },
    results: {
      verdict: SimulationVerdict.SUCCESS,
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
      const family = await buildSimulationRunsFamily({ findBatchSummary });

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
    it("names the miss with the code the caller can act on", async () => {
      const family = await buildSimulationRunsFamily();

      const response = await family.request("/api/simulation-runs/batches/missing");
      expect(response.status).toBe(404);
      // The code, not the sentence: the sentence is copy and the registry owns
      // what a customer reads for `batch_run_not_found`.
      await expect(response.json()).resolves.toMatchObject({ error: "batch_run_not_found" });
    });
  });

  describe("when a batch id is the only list filter", () => {
    /** @scenario "A batch id alone filters the list" */
    it("asks for that batch and preserves the published run fields", async () => {
      const getRunDataForBatchRun = vi.fn<SimulationService["getRunDataForBatchRun"]>(async () => ({
        changed: true as const,
        lastUpdatedAt: 2,
        runs: [run("run-a", "batch-a")],
      }));
      const family = await buildSimulationRunsFamily({ getRunDataForBatchRun });

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
            platformUrl:
              "https://app.langwatch.test/scenario-rest-project/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run-a",
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

  describe("when the project reads Agent Testing", () => {
    /** @scenario "A simulation run links to its run drawer in the interface the project reads" */
    it("links every listed run under /agent-testing, reading the flag once", async () => {
      const isEnabled = vi.fn(async () => true);
      const family = await buildSimulationRunsFamily({
        featureFlags: { isEnabled },
        getRunDataForBatchRun: async () => ({
          changed: true as const,
          lastUpdatedAt: 2,
          runs: [run("run-a", "batch-a"), run("run-b", "batch-a")],
        }),
      });

      const response = await family.request("/api/simulation-runs?batchRunId=batch-a");
      const body = await response.json();
      expect(body.runs.map((listed: { platformUrl: string }) => listed.platformUrl)).toEqual([
        "https://app.langwatch.test/scenario-rest-project/agent-testing/results?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run-a",
        "https://app.langwatch.test/scenario-rest-project/agent-testing/results?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run-b",
      ]);
      expect(isEnabled).toHaveBeenCalledTimes(1);
      expect(isEnabled).toHaveBeenCalledWith("release_ui_agent_testing_v2_enabled", {
        kind: "project",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      });
    });
  });

  describe("when a set-level list is read", () => {
    it("reports a trimmed run as messagesTruncated", async () => {
      const getRunDataForScenarioSet = vi.fn<SimulationService["getRunDataForScenarioSet"]>(
        async () => ({
          runs: [{ ...run("run-a", "batch-a"), messagesTruncated: true }],
          hasMore: false,
        }),
      );
      const family = await buildSimulationRunsFamily({ getRunDataForScenarioSet });

      const response = await family.request("/api/simulation-runs?scenarioSetId=set-a");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        runs: [{ scenarioRunId: "run-a", messagesTruncated: true }],
        hasMore: false,
      });
      expect(getRunDataForScenarioSet).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioSetId: "set-a", shouldIncludeMessages: false }),
      );
    });

    it("asks for whole conversations when include=messages is passed", async () => {
      const getRunDataForScenarioSet = vi.fn<SimulationService["getRunDataForScenarioSet"]>(
        async () => ({ runs: [], hasMore: true, nextCursor: "next" }),
      );
      const family = await buildSimulationRunsFamily({ getRunDataForScenarioSet });

      const response = await family.request(
        "/api/simulation-runs?scenarioSetId=set-a&include=messages",
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        runs: [],
        hasMore: true,
        nextCursor: "next",
      });
      expect(getRunDataForScenarioSet).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioSetId: "set-a", shouldIncludeMessages: true }),
      );
    });
  });
});
