import { createTenantId } from "@langwatch/eventing";
import {
  AGENT_TEST_SET_SUFFIX,
  SimulationRunStatus,
  VOICE_CALL_SCENARIO_SET_ID,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { simulationRunState as runState } from "../../../__tests__/support/simulation-run-state.fixture.ts";
import type { SimulationRunStateData } from "../../../eventing/simulation-run-state.projection.ts";
import { MemoryScenarioRepositories } from "../memory.scenario.repositories.ts";

const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";

function message(index: number) {
  return {
    Id: `m-${index}`,
    Role: index % 2 === 0 ? "user" : "assistant",
    Content: `message ${index}`,
    TraceId: `trace-${index}`,
    Rest: "",
  };
}

function inProject({
  projectId,
  state,
}: {
  projectId: string;
  state: SimulationRunStateData;
}): SimulationRunStateData & { projectId: string } {
  return { ...state, projectId };
}

/** Folds the runs through the registry's run processing, then reads them back through its twin. */
async function given(runs: (SimulationRunStateData & { projectId?: string })[]) {
  const repositories = MemoryScenarioRepositories.create();
  const store = repositories.simulationRunProcessing.runStateStore({
    defaultRetentionDays: () => 30,
  });
  for (const { projectId = PROJECT, ...state } of runs) {
    await store.store(state, {
      tenantId: createTenantId(projectId),
      aggregateId: state.ScenarioRunId,
    });
  }
  return { simulations: repositories.simulations, stalledRuns: repositories.stalledRuns };
}

describe("MemorySimulationRepository", () => {
  describe("when a run is read by id (findScenarioRunData)", () => {
    it("answers the run the fold holds, with its messages and verdict", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", Messages: [message(0), message(1)] }),
      ]);

      const run = await simulations.findScenarioRunData({
        projectId: PROJECT,
        scenarioRunId: "run-1",
      });

      expect(run?.scenarioRunId).toBe("run-1");
      expect(run?.status).toBe(SimulationRunStatus.SUCCESS);
      expect(run?.results?.metCriteria).toEqual(["greets the user"]);
      expect(run?.messages.map((m) => m.content)).toEqual(["message 0", "message 1"]);
      expect(run?.messages[0]?.trace_id).toBe("trace-0");
    });

    it("answers null for an archived run and for another project's run", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", ArchivedAt: 3_000 }),
        inProject({ projectId: OTHER_PROJECT, state: runState({ ScenarioRunId: "run-2" }) }),
      ]);

      expect(
        await simulations.findScenarioRunData({ projectId: PROJECT, scenarioRunId: "run-1" }),
      ).toBeNull();
      expect(
        await simulations.findScenarioRunData({ projectId: PROJECT, scenarioRunId: "run-2" }),
      ).toBeNull();
    });

    it("reads an unfinished run as in progress, whatever it stored", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", Status: "QUEUED", FinishedAt: null }),
      ]);

      const run = await simulations.findScenarioRunData({
        projectId: PROJECT,
        scenarioRunId: "run-1",
      });

      expect(run?.status).toBe(SimulationRunStatus.IN_PROGRESS);
    });
  });

  describe("when the scenario sets are read (findScenarioSetsData)", () => {
    it("counts runs per set, folds the empty set into default and hides agent tests", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", ScenarioSetId: "", UpdatedAt: 5_000 }),
        runState({ ScenarioRunId: "run-2", ScenarioSetId: "default", UpdatedAt: 6_000 }),
        runState({ ScenarioRunId: "run-3", ScenarioSetId: "set-b", UpdatedAt: 9_000 }),
        runState({ ScenarioRunId: "run-4", ScenarioSetId: `x${AGENT_TEST_SET_SUFFIX}` }),
        runState({ ScenarioRunId: "run-5", ScenarioSetId: VOICE_CALL_SCENARIO_SET_ID }),
        runState({ ScenarioRunId: "run-6", ScenarioSetId: "set-b", ArchivedAt: 1 }),
      ]);

      expect(await simulations.findScenarioSetsData({ projectId: PROJECT })).toEqual([
        { scenarioSetId: "set-b", scenarioCount: 1, lastRunAt: 9_000 },
        { scenarioSetId: "default", scenarioCount: 2, lastRunAt: 6_000 },
      ]);
    });

    it("keeps only runs started inside the window", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", StartedAt: 1_000 }),
        runState({ ScenarioRunId: "run-2", StartedAt: 5_000 }),
      ]);

      const sets = await simulations.findScenarioSetsData({
        projectId: PROJECT,
        startDate: 2_000,
        endDate: 6_000,
      });

      expect(sets).toEqual([{ scenarioSetId: "set-1", scenarioCount: 1, lastRunAt: 2_000 }]);
    });
  });

  describe("when a set's batch history is paged (listBatchHistoryForScenarioSet)", () => {
    it("pages batches newest first with counts, note, actor and previews", async () => {
      const metadata = JSON.stringify({
        note: "nightly",
        langwatch: { actorId: "user-1", actorLabel: "user" },
      });
      const { simulations } = await given([
        runState({ ScenarioRunId: "a-1", BatchRunId: "batch-a", CreatedAt: 1_000 }),
        runState({
          ScenarioRunId: "b-1",
          BatchRunId: "batch-b",
          CreatedAt: 3_000,
          Metadata: metadata,
          Messages: [0, 1, 2, 3, 4].map(message),
        }),
        runState({
          ScenarioRunId: "b-2",
          BatchRunId: "batch-b",
          CreatedAt: 3_100,
          Status: "IN_PROGRESS",
          FinishedAt: null,
          UpdatedAt: 4_000,
        }),
      ]);

      const first = await simulations.listBatchHistoryForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 1,
      });

      expect(first.totalCount).toBe(2);
      expect(first.hasMore).toBe(true);
      expect(first.lastUpdatedAt).toBe(4_000);
      expect(first.batches).toHaveLength(1);
      const [batch] = first.batches;
      expect(batch).toMatchObject({
        batchRunId: "batch-b",
        totalCount: 2,
        passCount: 1,
        runningCount: 1,
        settledCount: 1,
        lastRunAt: 3_100,
        firstCompletedAt: 2_000,
        allCompletedAt: null,
        note: "nightly",
        startedBy: { id: "user-1", label: "user" },
      });
      expect(batch?.items.map((item) => item.scenarioRunId)).toEqual(["b-1", "b-2"]);
      expect(batch?.items[0]?.messagePreview).toHaveLength(4);
      expect(batch?.items[1]?.status).toBe(SimulationRunStatus.IN_PROGRESS);

      const second = await simulations.listBatchHistoryForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(second.batches.map((b) => b.batchRunId)).toEqual(["batch-a"]);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).toBeUndefined();
    });

    it("answers an empty page with the set's total when nothing is in scope", async () => {
      const { simulations } = await given([]);

      expect(
        await simulations.listBatchHistoryForScenarioSet({
          projectId: PROJECT,
          scenarioSetId: "x",
        }),
      ).toEqual({ batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 });
    });
  });

  describe("when one batch is summarised (findBatchSummary)", () => {
    it("counts one batch and counts a stored stalled run as stalled", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", BatchRunId: "batch-1", Status: "STALLED" }),
        runState({ ScenarioRunId: "run-2", BatchRunId: "batch-1", Status: "FAILED" }),
        runState({ ScenarioRunId: "run-3", BatchRunId: "batch-2" }),
      ]);

      const summary = await simulations.findBatchSummary({
        projectId: PROJECT,
        batchRunId: "batch-1",
      });

      expect(summary).toMatchObject({
        batchRunId: "batch-1",
        totalCount: 2,
        passCount: 0,
        failCount: 1,
        settledCount: 2,
        stalledCount: 1,
        allCompletedAt: 2_000,
        note: null,
        startedBy: null,
      });
    });

    it("answers null for a batch the project does not hold", async () => {
      const { simulations } = await given([]);

      expect(
        await simulations.findBatchSummary({ projectId: PROJECT, batchRunId: "nope" }),
      ).toBeNull();
    });
  });

  describe("when a batch's runs are read (findRunDataForBatchRun)", () => {
    it("answers unchanged when nothing moved since the caller's timestamp", async () => {
      const { simulations } = await given([runState({ ScenarioRunId: "run-1", UpdatedAt: 5_000 })]);

      expect(
        await simulations.findRunDataForBatchRun({
          projectId: PROJECT,
          batchRunId: "batch-1",
          sinceTimestamp: 5_000,
        }),
      ).toEqual({ changed: false, lastUpdatedAt: 5_000 });
    });

    it("answers the batch's runs oldest first, narrowed to the set when one is named", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-2", CreatedAt: 2_000, StartedAt: 2_000 }),
        runState({ ScenarioRunId: "run-1", CreatedAt: 1_000, StartedAt: 1_000 }),
        runState({ ScenarioRunId: "run-3", ScenarioSetId: "other" }),
      ]);

      const all = await simulations.findRunDataForBatchRun({
        projectId: PROJECT,
        batchRunId: "batch-1",
        sinceTimestamp: 0,
      });
      const narrowed = await simulations.findRunDataForBatchRun({
        projectId: PROJECT,
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
      });

      expect(all.changed && all.runs.map((r) => r.scenarioRunId)).toEqual([
        "run-1",
        "run-3",
        "run-2",
      ]);
      expect(narrowed.changed && narrowed.runs.map((r) => r.scenarioRunId)).toEqual([
        "run-1",
        "run-2",
      ]);
      expect(narrowed.lastUpdatedAt).toBe(2_000);
    });
  });

  describe("when a set's batches are counted (findBatchRunCountForScenarioSet)", () => {
    it("counts distinct batches of the set inside the window", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", BatchRunId: "batch-1" }),
        runState({ ScenarioRunId: "run-2", BatchRunId: "batch-1" }),
        runState({ ScenarioRunId: "run-3", BatchRunId: "batch-2", StartedAt: 9_000 }),
        runState({ ScenarioRunId: "run-4", BatchRunId: "batch-3", ScenarioSetId: "other" }),
      ]);

      const count = (window: { startDate?: number; endDate?: number }) =>
        simulations.findBatchRunCountForScenarioSet({
          projectId: PROJECT,
          scenarioSetId: "set-1",
          ...window,
        });

      expect(await count({})).toBe(2);
      expect(await count({ endDate: 5_000 })).toBe(1);
    });
  });

  describe("when a set's runs are read whole (findAllRunDataForScenarioSet)", () => {
    it("answers every visible run of the set, by batch then creation", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-b", BatchRunId: "batch-b" }),
        runState({ ScenarioRunId: "run-a2", BatchRunId: "batch-a", CreatedAt: 2_000 }),
        runState({ ScenarioRunId: "run-a1", BatchRunId: "batch-a", CreatedAt: 1_000 }),
        runState({ ScenarioRunId: "run-x", ArchivedAt: 1 }),
      ]);

      const runs = await simulations.findAllRunDataForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
      });

      expect(runs.map((r) => r.scenarioRunId)).toEqual(["run-a1", "run-a2", "run-b"]);
    });
  });

  describe("when a set's runs are paged (listRunDataForScenarioSet)", () => {
    it("pages by batch and trims each run to the list projection", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "old", BatchRunId: "batch-old", CreatedAt: 1_000 }),
        runState({
          ScenarioRunId: "new",
          BatchRunId: "batch-new",
          CreatedAt: 2_000,
          Messages: [0, 1, 2, 3, 4, 5, 6, 7].map(message),
          TraceIds: ["trace-0"],
        }),
      ]);

      const page = await simulations.listRunDataForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 1,
      });

      expect(page.hasMore).toBe(true);
      expect(page.runs.map((r) => r.scenarioRunId)).toEqual(["new"]);
      expect(page.runs[0]?.messages).toHaveLength(6);
      expect(page.runs[0]?.messagesTruncated).toBe(true);
      expect(page.runs[0]?.results?.reasoning).toBeUndefined();

      const next = await simulations.listRunDataForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 1,
        cursor: page.nextCursor,
      });
      expect(next.runs.map((r) => r.scenarioRunId)).toEqual(["old"]);
      expect(next.hasMore).toBe(false);
    });

    it("keeps whole conversations when asked, stopping the page at a batch boundary", async () => {
      const big = Array.from({ length: 15 }, (_, i) =>
        runState({ ScenarioRunId: `big-${i}`, BatchRunId: "batch-big", CreatedAt: 3_000 + i }),
      );
      const small = Array.from({ length: 10 }, (_, i) =>
        runState({ ScenarioRunId: `small-${i}`, BatchRunId: "batch-small", CreatedAt: 1_000 + i }),
      );
      const { simulations } = await given([...big, ...small]);

      const page = await simulations.listRunDataForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 5,
        shouldIncludeMessages: true,
      });

      expect(page.runs).toHaveLength(15);
      expect(page.hasMore).toBe(true);
      const next = await simulations.listRunDataForScenarioSet({
        projectId: PROJECT,
        scenarioSetId: "set-1",
        limit: 5,
        shouldIncludeMessages: true,
        cursor: page.nextCursor,
      });
      expect(next.runs).toHaveLength(10);
    });
  });

  describe("when every suite is paged (findRunDataForAllSuites)", () => {
    it("pages every suite's batches and names each batch's set", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", BatchRunId: "batch-1", ScenarioSetId: "" }),
        runState({ ScenarioRunId: "run-2", BatchRunId: "batch-2", ScenarioSetId: "set-b" }),
        runState({
          ScenarioRunId: "run-3",
          BatchRunId: "batch-3",
          ScenarioSetId: `x${AGENT_TEST_SET_SUFFIX}`,
        }),
      ]);

      const page = await simulations.findRunDataForAllSuites({ projectId: PROJECT });

      expect(page.changed).toBe(true);
      if (!page.changed) return;
      expect(page.scenarioSetIds).toEqual({ "batch-1": "default", "batch-2": "set-b" });
      expect(page.runs.map((r) => r.scenarioRunId).toSorted()).toEqual(["run-1", "run-2"]);
      expect(page.hasMore).toBe(false);
    });

    it("answers unchanged when no listed run moved since the caller's timestamp", async () => {
      const { simulations } = await given([runState({ ScenarioRunId: "run-1", UpdatedAt: 4_000 })]);

      expect(
        await simulations.findRunDataForAllSuites({ projectId: PROJECT, sinceTimestamp: 4_000 }),
      ).toEqual({ changed: false, lastUpdatedAt: 4_000 });
    });
  });

  describe("when freshness is probed (findLastUpdatedAt)", () => {
    it("answers the newest update in the set, archived runs included", async () => {
      const recent = Date.now();
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", StartedAt: recent, UpdatedAt: recent + 10 }),
        runState({
          ScenarioRunId: "run-2",
          StartedAt: recent,
          UpdatedAt: recent + 20,
          ArchivedAt: 1,
        }),
        runState({
          ScenarioRunId: "run-3",
          ScenarioSetId: "other",
          StartedAt: recent,
          UpdatedAt: recent + 30,
        }),
      ]);

      expect(
        await simulations.findLastUpdatedAt({ projectId: PROJECT, scenarioSetId: "set-1" }),
      ).toBe(recent + 20);
    });

    it("floors an open window at thirty days", async () => {
      const { simulations } = await given([runState({ ScenarioRunId: "run-1", StartedAt: 1_000 })]);

      expect(await simulations.findLastUpdatedAt({ projectId: PROJECT })).toBe(0);
    });
  });

  describe("when the set summaries are read (findExternalSetSummaries)", () => {
    it("answers each set with its newest batch's counts", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "old-1", BatchRunId: "old", StartedAt: 1_000, Status: "FAILED" }),
        runState({ ScenarioRunId: "new-1", BatchRunId: "new", StartedAt: 5_000 }),
        runState({
          ScenarioRunId: "new-2",
          BatchRunId: "new",
          StartedAt: 5_100,
          Status: "STALLED",
        }),
        runState({ ScenarioRunId: "new-3", BatchRunId: "new", StartedAt: 5_200, Status: "QUEUED" }),
        runState({
          ScenarioRunId: "suite-1",
          BatchRunId: "suite",
          ScenarioSetId: "__internal__s1__suite",
          StartedAt: 7_000,
        }),
      ]);

      expect(await simulations.findExternalSetSummaries({ projectId: PROJECT })).toEqual([
        {
          scenarioSetId: "set-1",
          passedCount: 1,
          failedCount: 1,
          totalCount: 2,
          lastRunTimestamp: 5_000,
        },
      ]);
      expect(await simulations.findInternalSuiteSummaries({ projectId: PROJECT })).toEqual([
        {
          scenarioSetId: "__internal__s1__suite",
          passedCount: 1,
          failedCount: 0,
          totalCount: 1,
          lastRunTimestamp: 7_000,
        },
      ]);
    });
  });

  describe("when each scenario's last result is read (findLastResultSummaries)", () => {
    it("answers each scenario's most recently updated run", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", UpdatedAt: 2_000, StartedAt: 1_500, Status: "FAILED" }),
        runState({
          ScenarioRunId: "run-2",
          UpdatedAt: 3_000,
          StartedAt: 1_200,
          BatchRunId: "batch-2",
          TotalCost: 0.25,
          DurationMs: null,
        }),
        runState({ ScenarioRunId: "run-3", ScenarioId: "scenario-2" }),
      ]);

      const summaries = await simulations.findLastResultSummaries({
        projectId: PROJECT,
        scenarioIds: ["scenario-1"],
      });

      expect(summaries).toEqual([
        {
          scenarioId: "scenario-1",
          status: SimulationRunStatus.SUCCESS,
          metCriteriaCount: 1,
          unmetCriteriaCount: 0,
          lastRunAt: 1_500,
          batchRunId: "batch-2",
          scenarioSetId: "set-1",
          durationInMs: null,
          totalCost: 0.25,
        },
      ]);
      expect(
        await simulations.findLastResultSummaries({ projectId: PROJECT, scenarioIds: [] }),
      ).toEqual([]);
    });
  });

  describe("when a set's run ids are read (findAllRunIdsForSet)", () => {
    it("answers the default set's runs whether stored as '' or 'default'", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", ScenarioSetId: "" }),
        runState({ ScenarioRunId: "run-2", ScenarioSetId: "default" }),
        runState({ ScenarioRunId: "run-3", ScenarioSetId: "default", ArchivedAt: 1 }),
      ]);

      expect(
        await simulations.findAllRunIdsForSet({ projectId: PROJECT, scenarioSetId: "default" }),
      ).toEqual({ runIds: ["run-1", "run-2"], reachedCap: false });
    });
  });

  describe("when the external sets are listed (findDistinctExternalSetIds)", () => {
    it("answers the external sets across the projects asked", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", ScenarioSetId: "" }),
        inProject({
          projectId: OTHER_PROJECT,
          state: runState({ ScenarioRunId: "run-2", ScenarioSetId: "set-b" }),
        }),
        runState({ ScenarioRunId: "run-3", ScenarioSetId: "__internal__s1__suite" }),
        inProject({
          projectId: "project-3",
          state: runState({ ScenarioRunId: "run-4", ScenarioSetId: "set-c" }),
        }),
      ]);

      expect(
        await simulations.findDistinctExternalSetIds({ projectIds: [PROJECT, OTHER_PROJECT] }),
      ).toEqual(new Set(["default", "set-b"]));
      expect(await simulations.findDistinctExternalSetIds({ projectIds: [] })).toEqual(new Set());
    });
  });

  describe("when runs are exported (countRunsForExport)", () => {
    it("pages the filtered runs by start time and counts the same scope", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-c", StartedAt: 3_000, TraceIds: ["t-3"] }),
        runState({ ScenarioRunId: "run-a", StartedAt: 1_000, ScenarioSetId: "" }),
        runState({ ScenarioRunId: "run-b", StartedAt: 1_000, ScenarioSetId: "" }),
        runState({ ScenarioRunId: "run-d", StartedAt: 2_000, ScenarioId: "scenario-2" }),
      ]);

      expect(await simulations.countRunsForExport({ projectId: PROJECT })).toBe(4);
      expect(
        await simulations.countRunsForExport({ projectId: PROJECT, scenarioId: "scenario-2" }),
      ).toBe(1);
      expect(
        await simulations.countRunsForExport({ projectId: PROJECT, scenarioSetId: "default" }),
      ).toBe(2);

      const first = await simulations.listRunsForExport({ projectId: PROJECT, limit: 2 });
      expect(first.runs.map((r) => r.scenarioRunId)).toEqual(["run-a", "run-b"]);
      expect(first.runs[0]?.scenarioSetId).toBe("default");
      expect(first.hasMore).toBe(true);

      const second = await simulations.listRunsForExport({
        projectId: PROJECT,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.runs.map((r) => r.scenarioRunId)).toEqual(["run-d", "run-c"]);
      expect(second.runs[1]?.traceIds).toEqual(["t-3"]);
      expect(second.hasMore).toBe(false);
    });
  });

  describe("when runs are counted for usage (countUsage)", () => {
    it("counts visible runs across the projects, once per project", async () => {
      const { simulations } = await given([
        runState({ ScenarioRunId: "run-1", StartedAt: 1_000 }),
        inProject({
          projectId: OTHER_PROJECT,
          state: runState({ ScenarioRunId: "run-2", StartedAt: 5_000 }),
        }),
        runState({ ScenarioRunId: "run-3", ArchivedAt: 1 }),
      ]);

      const projectIds = [PROJECT, OTHER_PROJECT, PROJECT];
      expect(await simulations.countUsage({ projectIds })).toBe(2);
      expect(await simulations.countUsage({ projectIds, since: 2_000 })).toBe(1);
      expect(await simulations.countOrganizationRuns({ projectIds })).toBe(2);
      expect(await simulations.countOrganizationRuns({ projectIds: [] })).toBe(0);
    });
  });
});

describe("MemoryStalledSimulationRunRepository", () => {
  it("finds every tenant's unfinished run left untouched past the threshold, oldest first", async () => {
    const { stalledRuns } = await given([
      runState({ ScenarioRunId: "late", Status: "IN_PROGRESS", FinishedAt: null, UpdatedAt: 500 }),
      inProject({
        projectId: OTHER_PROJECT,
        state: runState({
          ScenarioRunId: "early",
          Status: "QUEUED",
          FinishedAt: null,
          UpdatedAt: 100,
        }),
      }),
      runState({ ScenarioRunId: "fresh", Status: "PENDING", FinishedAt: null, UpdatedAt: 9_500 }),
      runState({ ScenarioRunId: "done", Status: "SUCCESS", UpdatedAt: 100 }),
      runState({ ScenarioRunId: "gone", Status: "QUEUED", FinishedAt: null, ArchivedAt: 1 }),
    ]);

    const stalled = await stalledRuns.findStalledRuns({ now: 10_000, thresholdMs: 1_000 });

    expect(stalled).toEqual([
      {
        tenantId: OTHER_PROJECT,
        scenarioRunId: "early",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        status: "QUEUED",
      },
      {
        tenantId: PROJECT,
        scenarioRunId: "late",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        status: "IN_PROGRESS",
      },
    ]);
  });
});
