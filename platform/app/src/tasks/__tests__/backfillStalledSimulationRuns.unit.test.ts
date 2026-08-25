import { describe, expect, it, vi } from "vitest";
import type { StalledHistoricalRun } from "~/server/event-sourcing/pipelines/simulation-processing/repositories/stalledSimulationRuns.clickhouse.repository";
import { backfillStalledRuns } from "../backfillStalledSimulationRuns";

function makeRun(overrides: Partial<StalledHistoricalRun> = {}): StalledHistoricalRun {
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

function makeFinder(runs: StalledHistoricalRun[]) {
  return { findStalledRuns: vi.fn().mockResolvedValue(runs) };
}

function makeEmitter() {
  return { ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined) };
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
      const emitter = makeEmitter();

      const outcome = await backfillStalledRuns({
        finder: makeFinder(runs),
        emitter,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 2, closed: 2, failed: 0 });
      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledTimes(2);
      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledWith({
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
      const emitter = makeEmitter();
      emitter.ensureFailureEventsEmitted.mockRejectedValueOnce(
        new Error("event store unavailable"),
      );

      const outcome = await backfillStalledRuns({
        finder: makeFinder(runs),
        emitter,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 3, closed: 2, failed: 1 });
      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledTimes(3);
    });
  });

  describe("when running in dry-run mode", () => {
    /** @scenario "The backfill dry run measures the population without writing" */
    it("reports the population and writes nothing", async () => {
      const emitter = makeEmitter();

      const outcome = await backfillStalledRuns({
        finder: makeFinder([makeRun(), makeRun({ scenarioRunId: "run-2" })]),
        emitter,
        dryRun: true,
      });

      expect(outcome).toEqual({ found: 2, closed: 0, failed: 0 });
      expect(emitter.ensureFailureEventsEmitted).not.toHaveBeenCalled();
    });
  });

  describe("when no stalled runs exist", () => {
    it("reports zero without emitting", async () => {
      const emitter = makeEmitter();

      const outcome = await backfillStalledRuns({
        finder: makeFinder([]),
        emitter,
        dryRun: false,
      });

      expect(outcome).toEqual({ found: 0, closed: 0, failed: 0 });
      expect(emitter.ensureFailureEventsEmitted).not.toHaveBeenCalled();
    });
  });
});
