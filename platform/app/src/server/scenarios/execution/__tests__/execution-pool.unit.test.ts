/**
 * Unit tests for ScenarioExecutionPool.
 *
 * The pool is a registry of live children, not a queue: pending work is an
 * outbox row and concurrency is the dispatcher's (ADR-073 step 2, retired;
 * ground now ADR-103). What is
 * left to test is what cancellation depends on.
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionJobData } from "../execution-pool";
import { ScenarioExecutionPool } from "../execution-pool";

function makeFakeChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as any).kill = vi.fn();
  (child as any).pid = Math.floor(Math.random() * 100000);
  return child;
}

function makeJob(scenarioRunId: string): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: `scen-${scenarioRunId}`,
    scenarioRunId,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

describe("ScenarioExecutionPool", () => {
  let pool: ScenarioExecutionPool;

  beforeEach(() => {
    pool = new ScenarioExecutionPool();
  });

  describe("when a child is registered", () => {
    it("makes it findable by run id so a cancel can signal it", () => {
      const child = makeFakeChild();
      pool.registerChild({ job: makeJob("run-1"), child });

      expect(pool.findChild("run-1")).toBe(child);
      expect(pool.activeCount).toBe(1);
    });

    it("keeps the job behind it, so a shutdown can end the run it belongs to", () => {
      pool.registerChild({ job: makeJob("run-1"), child: makeFakeChild() });
      pool.registerChild({ job: makeJob("run-2"), child: makeFakeChild() });

      expect(pool.inFlightJobs.map((job) => job.scenarioRunId)).toEqual([
        "run-1",
        "run-2",
      ]);
    });
  });

  describe("when a child exits", () => {
    it("drops it from the registry", () => {
      pool.registerChild({ job: makeJob("run-1"), child: makeFakeChild() });
      pool.deregisterChild("run-1");

      expect(pool.findChild("run-1")).toBeUndefined();
      expect(pool.inFlightJobs).toEqual([]);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe("wasCancelled", () => {
    it("returns false for non-cancelled runs", () => {
      expect(pool.wasCancelled("run-1")).toBe(false);
    });

    it("returns true after markCancelled", () => {
      pool.markCancelled("run-1");
      expect(pool.wasCancelled("run-1")).toBe(true);
    });

    it("remembers a cancel that arrived before the run was ever registered", () => {
      // The pre-dispatch case: the broadcast lands while the dispatch is
      // still an outbox row, and the executor has to see it before it
      // spawns anything.
      pool.markCancelled("run-1");

      expect(pool.wasCancelled("run-1")).toBe(true);
      expect(pool.activeCount).toBe(0);
    });
  });

  describe("when the pool is drained", () => {
    it("kills every running child", () => {
      const child1 = makeFakeChild();
      const child2 = makeFakeChild();
      pool.registerChild({ job: makeJob("run-1"), child: child1 });
      pool.registerChild({ job: makeJob("run-2"), child: child2 });

      pool.drain();

      expect((child1 as any).kill).toHaveBeenCalledWith("SIGTERM");
      expect((child2 as any).kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});
