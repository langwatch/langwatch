/**
 * Unit tests for the in-flight failure emission that runs when the scenario
 * processor shuts down (graceful drain / worker max-runtime restart).
 *
 * Builds a real ScenarioExecutionPool with a no-op spawn function so submitted
 * jobs stay in-flight, then exercises drainInFlightRuns (the logic close()
 * runs) with a mock failure emitter. This is the path that stops in-flight
 * runs from orphaning at QUEUED when the worker restarts.
 *
 * @see specs/scenarios/queued-run-orphan-recovery.feature "In-flight runs are failed when the worker restarts"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { ScenarioExecutionPool } from "../execution/execution-pool";
import type { ExecutionJobData } from "../execution/execution-pool";
import type { ProcessorDependencies } from "../scenario.processor";
import { drainInFlightRuns } from "../scenario.processor";

function makeJob(id: string): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: `scen-${id}`,
    scenarioRunId: id,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

describe("drainInFlightRuns", () => {
  let pool: ScenarioExecutionPool;
  let mockGetById: ReturnType<typeof vi.fn>;
  let mockEnsureFailureEventsEmitted: ReturnType<typeof vi.fn>;
  let deps: ProcessorDependencies;

  beforeEach(() => {
    // concurrency 1: one job runs, the next is buffered as pending — gives us
    // both an in-flight running job and an in-flight pending job.
    pool = new ScenarioExecutionPool({ concurrency: 1 });
    // Register a fake child so the single slot is occupied — this is what
    // makes the SECOND submit buffer as pending (the concurrency gate checks
    // `_running`, which only fills via registerChild). The child is never
    // deregistered, so jobs stay in-flight until drain.
    pool.setSpawnFunction(async (jobData) => {
      pool.registerChild(
        jobData.scenarioRunId,
        { kill: () => true } as unknown as ChildProcess,
      );
    });

    mockGetById = vi
      .fn()
      .mockResolvedValue({ name: "Test Scenario", situation: "A test" });
    mockEnsureFailureEventsEmitted = vi.fn().mockResolvedValue(undefined);
    deps = {
      scenarioLookup: {
        getById:
          mockGetById as ProcessorDependencies["scenarioLookup"]["getById"],
      },
      failureEmitter: {
        ensureFailureEventsEmitted:
          mockEnsureFailureEventsEmitted as ProcessorDependencies["failureEmitter"]["ensureFailureEventsEmitted"],
      },
    };
  });

  describe("given a running job and a buffered pending job", () => {
    describe("when the processor drains for a worker restart", () => {
      it("emits a terminal failure for every in-flight run", async () => {
        pool.submit(makeJob("running-run")); // starts immediately
        pool.submit(makeJob("pending-run")); // buffered (concurrency is 1)

        await drainInFlightRuns(pool, deps);

        expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledTimes(2);
        const emittedRunIds = mockEnsureFailureEventsEmitted.mock.calls.map(
          (call) => (call[0] as { scenarioRunId: string }).scenarioRunId,
        );
        expect(emittedRunIds).toEqual(
          expect.arrayContaining(["running-run", "pending-run"]),
        );
      });

      it("clears the pending queue (drain happened)", async () => {
        pool.submit(makeJob("running-run"));
        pool.submit(makeJob("pending-run"));

        expect(pool.pendingCount).toBe(1);

        await drainInFlightRuns(pool, deps);

        expect(pool.pendingCount).toBe(0);
      });
    });
  });

  describe("given one emission rejects", () => {
    describe("when the processor drains", () => {
      it("still drains the pool and emits for the other run", async () => {
        mockEnsureFailureEventsEmitted
          .mockRejectedValueOnce(new Error("emit failed"))
          .mockResolvedValueOnce(undefined);

        pool.submit(makeJob("running-run"));
        pool.submit(makeJob("pending-run"));

        // Must not throw despite one emission rejecting.
        await drainInFlightRuns(pool, deps);

        expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledTimes(2);
        expect(pool.pendingCount).toBe(0);
      });
    });
  });

  describe("given no in-flight runs", () => {
    describe("when the processor drains", () => {
      it("emits nothing", async () => {
        await drainInFlightRuns(pool, deps);
        expect(mockEnsureFailureEventsEmitted).not.toHaveBeenCalled();
      });
    });
  });
});
