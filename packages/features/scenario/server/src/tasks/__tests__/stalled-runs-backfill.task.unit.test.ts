import {
  ScenarioExecutionService,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionPreparation,
  type ScenarioUnsuccessfulExecutionInput,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import type { SimulationStalledRun } from "@langwatch/scenario-server";
import { backfillStalledRuns, StalledRunsBackfillTask } from "../stalled-runs-backfill.task";

function makeRun(overrides: Partial<SimulationStalledRun> = {}): SimulationStalledRun {
  return {
    tenantId: "tenant-1",
    scenarioRunId: "run-1",
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    status: "IN_PROGRESS",
    ...overrides,
  };
}

function makeFinder(runs: SimulationStalledRun[]) {
  return { findStalledRuns: vi.fn().mockResolvedValue(runs) };
}

class TestScenarioExecutionService extends ScenarioExecutionService {
  readonly finishUnsuccessfulRun = vi.fn((_input: ScenarioUnsuccessfulExecutionInput) =>
    Promise.resolve(),
  );

  submit(_input: ScenarioExecutionJob): Promise<void> {
    throw new Error("submit unexpectedly called in backfill tests");
  }

  cancel(_input: { projectId: string; scenarioRunId: string }): Promise<void> {
    throw new Error("cancel unexpectedly called in backfill tests");
  }

  prefetch(_input: ScenarioExecutionPrefetchInput): Promise<ScenarioExecutionPrefetchResult> {
    throw new Error("prefetch unexpectedly called in backfill tests");
  }

  prepare(_input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation {
    throw new Error("prepare unexpectedly called in backfill tests");
  }
}

describe("backfillStalledRuns", () => {
  describe("when stalled historical runs are found", () => {
    /** @scenario "Historical runs with no terminal event are closed by the backfill task" */
    it("closes each run with a stalled terminal error scoped to its tenant", async () => {
      const runs = [
        makeRun(),
        makeRun({
          tenantId: "tenant-2",
          scenarioRunId: "run-2",
          status: "QUEUED",
        }),
      ];
      const execution = new TestScenarioExecutionService();

      const outcome = await backfillStalledRuns({
        finder: makeFinder(runs),
        execution,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 2, closed: 2, failed: 0 });
      expect(execution.finishUnsuccessfulRun).toHaveBeenCalledTimes(2);
      expect(execution.finishUnsuccessfulRun).toHaveBeenCalledWith({
        projectId: "tenant-2",
        scenarioId: "scenario-1",
        setId: "set-1",
        batchRunId: "batch-1",
        scenarioRunId: "run-2",
        error: "stalled",
      });
    });

    it("keeps closing the remaining runs when one terminal write fails", async () => {
      const runs = [
        makeRun({ scenarioRunId: "run-1" }),
        makeRun({ scenarioRunId: "run-2" }),
        makeRun({ scenarioRunId: "run-3" }),
      ];
      const execution = new TestScenarioExecutionService();
      execution.finishUnsuccessfulRun.mockRejectedValueOnce(new Error("event store unavailable"));

      const outcome = await backfillStalledRuns({
        finder: makeFinder(runs),
        execution,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 3, closed: 2, failed: 1 });
      expect(execution.finishUnsuccessfulRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("when running in dry-run mode", () => {
    /** @scenario "The backfill dry run measures the population without writing" */
    it("reports the population and writes nothing", async () => {
      const execution = new TestScenarioExecutionService();

      const outcome = await backfillStalledRuns({
        finder: makeFinder([makeRun(), makeRun({ scenarioRunId: "run-2" })]),
        execution,
        dryRun: true,
      });

      expect(outcome).toEqual({ found: 2, closed: 0, failed: 0 });
      expect(execution.finishUnsuccessfulRun).not.toHaveBeenCalled();
    });
  });

  describe("when no stalled runs exist", () => {
    it("reports zero without emitting", async () => {
      const execution = new TestScenarioExecutionService();

      const outcome = await backfillStalledRuns({
        finder: makeFinder([]),
        execution,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 0, closed: 0, failed: 0 });
      expect(execution.finishUnsuccessfulRun).not.toHaveBeenCalled();
    });
  });
});

describe("StalledRunsBackfillTask", () => {
  describe("when constructed", () => {
    /** @scenario "Composing the task never resolves its collaborators" */
    it("does not call the finder or execution factories until run()", () => {
      const finder = vi.fn(() => makeFinder([]));
      const execution = vi.fn(() => new TestScenarioExecutionService());

      StalledRunsBackfillTask.create({ finder, execution });

      expect(finder).not.toHaveBeenCalled();
      expect(execution).not.toHaveBeenCalled();
    });
  });

  describe("when run", () => {
    /** @scenario "A run resolves both collaborators exactly once and delegates to the backfill" */
    it("resolves the factories and closes every stalled run through them", async () => {
      const runs = [makeRun()];
      const finder = vi.fn(() => makeFinder(runs));
      const testExecution = new TestScenarioExecutionService();
      const execution = vi.fn(() => testExecution);
      const task = StalledRunsBackfillTask.create({ finder, execution });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(finder).toHaveBeenCalledTimes(1);
      expect(execution).toHaveBeenCalledTimes(1);
      expect(testExecution.finishUnsuccessfulRun).toHaveBeenCalledWith({
        projectId: "tenant-1",
        scenarioId: "scenario-1",
        setId: "set-1",
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        error: "stalled",
      });
    });
  });
});
