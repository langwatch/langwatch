import { describe, expect, it, vi } from "vitest";
import {
  ORPHAN_ERROR_MESSAGE,
  ORPHAN_RECONCILE_THRESHOLD_MS,
  type OrphanedRun,
  type OrphanedRunFinder,
  type OrphanFailureEmitter,
  reconcileOrphanedRuns,
} from "../orphaned-run-reconciliation";
import { STALL_THRESHOLD_MS } from "../stall-detection";

function makeOrphan(overrides: Partial<OrphanedRun> = {}): OrphanedRun {
  return {
    tenantId: "project-1",
    scenarioRunId: "run-1",
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    status: "QUEUED",
    ...overrides,
  };
}

function finderReturning(runs: OrphanedRun[]): OrphanedRunFinder {
  return { findOrphanedRuns: vi.fn().mockResolvedValue(runs) };
}

function spyEmitter(): OrphanFailureEmitter {
  return { ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined) };
}

describe("reconcileOrphanedRuns", () => {
  describe("given the finder surfaces an orphaned run", () => {
    it("emits a terminal failure event scoped to the run's tenant", async () => {
      const finder = finderReturning([
        makeOrphan({
          tenantId: "project-9",
          scenarioRunId: "run-orphan",
          scenarioId: "scenario-9",
          batchRunId: "batch-9",
          scenarioSetId: "set-9",
        }),
      ]);
      const emitter = spyEmitter();

      const result = await reconcileOrphanedRuns({
        finder,
        failureEmitter: emitter,
      });

      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledTimes(1);
      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledWith({
        projectId: "project-9",
        scenarioId: "scenario-9",
        setId: "set-9",
        batchRunId: "batch-9",
        scenarioRunId: "run-orphan",
        error: ORPHAN_ERROR_MESSAGE,
      });
      expect(result).toEqual({ reconciled: 1, failed: 0 });
    });
  });

  describe("given the finder surfaces no orphaned runs", () => {
    it("emits nothing", async () => {
      const finder = finderReturning([]);
      const emitter = spyEmitter();

      const result = await reconcileOrphanedRuns({
        finder,
        failureEmitter: emitter,
      });

      expect(emitter.ensureFailureEventsEmitted).not.toHaveBeenCalled();
      expect(result).toEqual({ reconciled: 0, failed: 0 });
    });
  });

  describe("given emitting the terminal event fails for one run", () => {
    it("still reconciles the remaining runs and reports the failure", async () => {
      const finder = finderReturning([
        makeOrphan({ scenarioRunId: "run-a" }),
        makeOrphan({ scenarioRunId: "run-b" }),
        makeOrphan({ scenarioRunId: "run-c" }),
      ]);
      const emitter: OrphanFailureEmitter = {
        ensureFailureEventsEmitted: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("clickhouse down"))
          .mockResolvedValueOnce(undefined),
      };

      const result = await reconcileOrphanedRuns({
        finder,
        failureEmitter: emitter,
      });

      expect(emitter.ensureFailureEventsEmitted).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ reconciled: 2, failed: 1 });
    });
  });

  describe("given a now and an explicit threshold", () => {
    it("passes them through to the finder", async () => {
      const finder = finderReturning([]);
      const emitter = spyEmitter();

      await reconcileOrphanedRuns({
        finder,
        failureEmitter: emitter,
        now: 1_000_000,
        thresholdMs: 5_000,
      });

      expect(finder.findOrphanedRuns).toHaveBeenCalledWith({
        now: 1_000_000,
        thresholdMs: 5_000,
      });
    });
  });

  describe("when no threshold is supplied", () => {
    it("defaults the finder to the read-path stall threshold", async () => {
      const finder = finderReturning([]);
      const emitter = spyEmitter();

      await reconcileOrphanedRuns({ finder, failureEmitter: emitter });

      expect(finder.findOrphanedRuns).toHaveBeenCalledWith(
        expect.objectContaining({ thresholdMs: STALL_THRESHOLD_MS }),
      );
      // The write-path threshold is anchored to the read-path's STALLED line.
      expect(ORPHAN_RECONCILE_THRESHOLD_MS).toBe(STALL_THRESHOLD_MS);
    });
  });
});
