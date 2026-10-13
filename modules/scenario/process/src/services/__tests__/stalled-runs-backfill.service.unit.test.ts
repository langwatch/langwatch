import {
  ScenarioExecutionService,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionPreparation,
  type ScenarioUnsuccessfulExecutionInput,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import type { SimulationStalledRun } from "../../eventing/simulation-eventing.store.ts";
import { StalledRunsBackfillService } from "../stalled-runs-backfill.service.ts";

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

  readonly recordAgentInstance = vi.fn(() => Promise.resolve());

  readonly recordCutAtLimit = vi.fn(() => Promise.resolve());

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

describe("StalledRunsBackfillService", () => {
  describe("when stalled historical runs are found", () => {
    /** @scenario "The background step closes stalled historical runs" */
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

      const outcome = await StalledRunsBackfillService.create({
        finder: makeFinder(runs),
        execution,
      }).backfill({ dryRun: false });

      expect(outcome).toEqual({ found: 2, closed: 2, failed: 0, dryRun: false });
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
  });

  describe("when a terminal write fails", () => {
    /** @scenario "A failed close fails the step so it retries" */
    it("still closes the remaining runs, then throws so the step retries", async () => {
      const runs = [
        makeRun({ scenarioRunId: "run-1" }),
        makeRun({ scenarioRunId: "run-2" }),
        makeRun({ scenarioRunId: "run-3" }),
      ];
      const execution = new TestScenarioExecutionService();
      execution.finishUnsuccessfulRun.mockRejectedValueOnce(new Error("event store unavailable"));

      await expect(
        StalledRunsBackfillService.create({ finder: makeFinder(runs), execution }).backfill({
          dryRun: false,
        }),
      ).rejects.toThrow("1 stalled runs failed to close");
      expect(execution.finishUnsuccessfulRun).toHaveBeenCalledTimes(3);
    });
  });

  describe("when running in dry-run mode", () => {
    /** @scenario "A dry run of the step closes nothing" */
    it("reports the population and writes nothing", async () => {
      const execution = new TestScenarioExecutionService();

      const outcome = await StalledRunsBackfillService.create({
        finder: makeFinder([makeRun(), makeRun({ scenarioRunId: "run-2" })]),
        execution,
      }).backfill({ dryRun: true });

      expect(outcome).toEqual({ found: 2, closed: 0, failed: 0, dryRun: true });
      expect(execution.finishUnsuccessfulRun).not.toHaveBeenCalled();
    });
  });

  describe("when no stalled runs exist", () => {
    it("reports zero without emitting", async () => {
      const execution = new TestScenarioExecutionService();

      const outcome = await StalledRunsBackfillService.create({
        finder: makeFinder([]),
        execution,
      }).backfill({ dryRun: false });

      expect(outcome).toEqual({ found: 0, closed: 0, failed: 0, dryRun: false });
      expect(execution.finishUnsuccessfulRun).not.toHaveBeenCalled();
    });
  });
});
