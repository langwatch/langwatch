/**
 * Unit tests for the queued-run orphan reconciler.
 *
 * Covers the pure orphan gate (isOrphanedQueuedRun) and the orchestrator
 * (reconcileOrphanedQueuedRuns) with injected fakes — no ClickHouse access.
 *
 * @see specs/scenarios/queued-run-orphan-recovery.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  isOrphanedQueuedRun,
  ORPHAN_QUEUED_THRESHOLD_MS,
  type OrphanCandidate,
  reconcileOrphanedQueuedRuns,
} from "../scenario-orphan-reconciler";

const THRESHOLD_MS = ORPHAN_QUEUED_THRESHOLD_MS;
const NOW = 1_700_000_000_000;

function makeCandidate(overrides: Partial<OrphanCandidate>): OrphanCandidate {
  return {
    projectId: "proj-1",
    scenarioRunId: "run-1",
    scenarioId: "scen-1",
    batchRunId: "batch-1",
    setId: "set-1",
    lastEventAtMs: NOW - THRESHOLD_MS - 1,
    status: "QUEUED",
    ...overrides,
  };
}

describe("isOrphanedQueuedRun", () => {
  describe("given a QUEUED run", () => {
    describe("when the last event is older than the threshold", () => {
      it("flags it as orphaned", () => {
        expect(
          isOrphanedQueuedRun({
            status: "QUEUED",
            lastEventAtMs: NOW - THRESHOLD_MS - 1,
            now: NOW,
            thresholdMs: THRESHOLD_MS,
          }),
        ).toBe(true);
      });
    });

    describe("when the last event is exactly at the threshold", () => {
      it("flags it as orphaned at the exact threshold boundary", () => {
        expect(
          isOrphanedQueuedRun({
            status: "QUEUED",
            lastEventAtMs: NOW - THRESHOLD_MS,
            now: NOW,
            thresholdMs: THRESHOLD_MS,
          }),
        ).toBe(true);
      });
    });

    describe("when the run was queued recently", () => {
      it("does not flag it as orphaned", () => {
        expect(
          isOrphanedQueuedRun({
            status: "QUEUED",
            lastEventAtMs: NOW - 1000,
            now: NOW,
            thresholdMs: THRESHOLD_MS,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a non-QUEUED run", () => {
    describe("when the last event is older than the threshold", () => {
      it("does not flag it as orphaned", () => {
        expect(
          isOrphanedQueuedRun({
            status: "IN_PROGRESS",
            lastEventAtMs: NOW - THRESHOLD_MS - 1,
            now: NOW,
            thresholdMs: THRESHOLD_MS,
          }),
        ).toBe(false);
      });
    });
  });
});

describe("reconcileOrphanedQueuedRuns", () => {
  describe("given candidates with mixed status and age", () => {
    describe("when reconciling", () => {
      it("emits a failure only for the long-abandoned queued run", async () => {
        const oldQueued = makeCandidate({
          scenarioRunId: "old-queued",
          status: "QUEUED",
          lastEventAtMs: NOW - THRESHOLD_MS - 1,
        });
        const recentQueued = makeCandidate({
          scenarioRunId: "recent-queued",
          status: "QUEUED",
          lastEventAtMs: NOW - 1000,
        });
        const oldNonQueued = makeCandidate({
          scenarioRunId: "old-in-progress",
          status: "IN_PROGRESS",
          lastEventAtMs: NOW - THRESHOLD_MS - 1,
        });
        const emitFailure = vi.fn().mockResolvedValue(undefined);

        const result = await reconcileOrphanedQueuedRuns({
          findCandidates: vi
            .fn()
            .mockResolvedValue([oldQueued, recentQueued, oldNonQueued]),
          emitFailure,
          now: NOW,
          thresholdMs: THRESHOLD_MS,
        });

        expect(emitFailure).toHaveBeenCalledTimes(1);
        expect(emitFailure).toHaveBeenCalledWith(oldQueued);
        expect(result).toEqual({ failed: 1, skipped: 2, errored: 0 });
      });
    });
  });

  describe("given an emitFailure that rejects for one candidate", () => {
    describe("when reconciling multiple orphans", () => {
      it("still processes the remaining orphans and counts the failures", async () => {
        const orphanA = makeCandidate({ scenarioRunId: "orphan-a" });
        const orphanB = makeCandidate({ scenarioRunId: "orphan-b" });
        const emitFailure = vi
          .fn()
          .mockRejectedValueOnce(new Error("emit blew up"))
          .mockResolvedValueOnce(undefined);

        const result = await reconcileOrphanedQueuedRuns({
          findCandidates: vi.fn().mockResolvedValue([orphanA, orphanB]),
          emitFailure,
          now: NOW,
          thresholdMs: THRESHOLD_MS,
        });

        expect(emitFailure).toHaveBeenCalledTimes(2);
        expect(emitFailure).toHaveBeenCalledWith(orphanA);
        expect(emitFailure).toHaveBeenCalledWith(orphanB);
        // One emission succeeded, the rejecting one is counted as errored.
        expect(result).toEqual({ failed: 1, skipped: 0, errored: 1 });
      });
    });
  });

  describe("given no candidates", () => {
    describe("when reconciling", () => {
      it("emits nothing and returns zero counts", async () => {
        const emitFailure = vi.fn().mockResolvedValue(undefined);

        const result = await reconcileOrphanedQueuedRuns({
          findCandidates: vi.fn().mockResolvedValue([]),
          emitFailure,
          now: NOW,
          thresholdMs: THRESHOLD_MS,
        });

        expect(emitFailure).not.toHaveBeenCalled();
        expect(result).toEqual({ failed: 0, skipped: 0, errored: 0 });
      });
    });
  });
});
