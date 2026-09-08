/**
 * Unit tests for ScenarioExecutionPool.
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionJobData } from "../execution-pool";
import { ScenarioExecutionPool } from "../execution-pool";

function makeJob(id: string): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: "scen-1",
    scenarioRunId: id,
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

function makeFakeChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  (child as any).kill = vi.fn();
  (child as any).pid = Math.floor(Math.random() * 100000);
  return child;
}

describe("ScenarioExecutionPool", () => {
  let pool: ScenarioExecutionPool;
  let spawnedJobs: ExecutionJobData[];

  beforeEach(() => {
    spawnedJobs = [];
    pool = new ScenarioExecutionPool({ concurrency: 2 });
    pool.setSpawnFunction(async (jobData) => {
      spawnedJobs.push(jobData);
      // Simulate: register child, then "run" until deregistered
      const child = makeFakeChild();
      pool.registerChild(jobData.scenarioRunId, child);
    });
  });

  describe("when pool has capacity", () => {
    it("starts the job immediately", () => {
      pool.submit(makeJob("run-1"));
      expect(spawnedJobs).toHaveLength(1);
      expect(spawnedJobs[0]!.scenarioRunId).toBe("run-1");
    });
  });

  describe("when pool is at capacity", () => {
    it("buffers the job", () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3"));

      expect(spawnedJobs).toHaveLength(2);
      expect(pool.pendingCount).toBe(1);
    });

    it("dequeues when a slot opens", async () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3")); // pending

      expect(spawnedJobs).toHaveLength(2);

      // Complete run-1
      pool.deregisterChild("run-1");

      // Allow microtask for fire-and-forget spawn
      await new Promise((r) => setTimeout(r, 10));

      expect(spawnedJobs).toHaveLength(3);
      expect(spawnedJobs[2]!.scenarioRunId).toBe("run-3");
    });
  });

  describe("when a cancelled job is submitted", () => {
    it("skips the job entirely", () => {
      pool.markCancelled("run-1");
      pool.submit(makeJob("run-1"));

      expect(spawnedJobs).toHaveLength(0);
    });

    it("calls onSkipCancelled so the terminal event is written", () => {
      const onSkip = vi.fn();
      pool.setOnSkipCancelled(onSkip);

      pool.markCancelled("run-1");
      pool.submit(makeJob("run-1"));

      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onSkip).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "run-1" }),
      );
    });
  });

  describe("when cancel arrives for a pending job", () => {
    it("skips the cancelled pending job when dequeuing", async () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3")); // pending

      // Cancel run-3 while it's pending
      pool.markCancelled("run-3");

      // Complete run-1 to trigger dequeue
      pool.deregisterChild("run-1");
      await new Promise((r) => setTimeout(r, 10));

      // run-3 should NOT have been spawned
      expect(spawnedJobs).toHaveLength(2);
      expect(pool.pendingCount).toBe(0);
    });

    it("calls onSkipCancelled for the skipped pending job", async () => {
      const onSkip = vi.fn();
      pool.setOnSkipCancelled(onSkip);

      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3")); // pending

      pool.markCancelled("run-3");
      pool.deregisterChild("run-1");
      await new Promise((r) => setTimeout(r, 10));

      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onSkip).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "run-3" }),
      );
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
  });

  describe("drain", () => {
    it("clears pending queue and kills running children", () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3")); // pending

      const child1 = pool.runningChildren.get("run-1");
      const child2 = pool.runningChildren.get("run-2");

      pool.drain();

      expect(pool.pendingCount).toBe(0);
      expect((child1 as any).kill).toHaveBeenCalledWith("SIGTERM");
      expect((child2 as any).kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("given a slow prefetch that has not yet registered a child", () => {
    // #27: admission must count the job as soon as it is admitted (before its
    // child ever registers), or a second submit sees the still-empty
    // `_running` map and starts past `_concurrency`.
    it("does not admit a second job at concurrency 1 until the first deregisters", async () => {
      let releaseFirstPrefetch: (() => void) | undefined;
      let resolveRun1Registered: (() => void) | undefined;
      const run1Registered = new Promise<void>((resolve) => {
        resolveRun1Registered = resolve;
      });
      let resolveRun2Started: (() => void) | undefined;
      const run2Started = new Promise<void>((resolve) => {
        resolveRun2Started = resolve;
      });
      const slowPool = new ScenarioExecutionPool({ concurrency: 1 });
      const slowSpawned: ExecutionJobData[] = [];
      slowPool.setSpawnFunction(async (jobData) => {
        slowSpawned.push(jobData);
        if (jobData.scenarioRunId === "run-2") resolveRun2Started?.();
        if (jobData.scenarioRunId === "run-1") {
          await new Promise<void>((resolve) => {
            releaseFirstPrefetch = resolve;
          });
        }
        slowPool.registerChild(jobData.scenarioRunId, makeFakeChild());
        if (jobData.scenarioRunId === "run-1") resolveRun1Registered?.();
      });

      slowPool.submit(makeJob("run-1"));
      slowPool.submit(makeJob("run-2")); // must stay pending, not start

      expect(slowSpawned.map((j) => j.scenarioRunId)).toEqual(["run-1"]);
      expect(slowPool.pendingCount).toBe(1);

      // run-1's prefetch finishes and its child registers.
      releaseFirstPrefetch?.();
      await run1Registered;
      slowPool.deregisterChild("run-1");
      await run2Started;

      expect(slowSpawned.map((j) => j.scenarioRunId)).toEqual([
        "run-1",
        "run-2",
      ]);
      expect(slowPool.pendingCount).toBe(0);
    });
  });

  describe("inFlightJobs", () => {
    describe("when jobs are running and buffered", () => {
      it("returns both running and pending job data", () => {
        pool.submit(makeJob("run-1")); // running
        pool.submit(makeJob("run-2")); // running
        pool.submit(makeJob("run-3")); // pending

        const inFlightIds = pool.inFlightJobs.map((j) => j.scenarioRunId);

        expect(inFlightIds).toHaveLength(3);
        expect(inFlightIds).toEqual(
          expect.arrayContaining(["run-1", "run-2", "run-3"]),
        );
      });
    });

    describe("when a running child is deregistered", () => {
      it("drops it from the in-flight set", () => {
        pool.submit(makeJob("run-1"));
        pool.submit(makeJob("run-2"));

        pool.deregisterChild("run-1");

        const inFlightIds = pool.inFlightJobs.map((j) => j.scenarioRunId);
        expect(inFlightIds).not.toContain("run-1");
        expect(inFlightIds).toContain("run-2");
      });
    });

    describe("when the pool is empty", () => {
      it("returns an empty list", () => {
        expect(pool.inFlightJobs).toEqual([]);
      });
    });
  });
});
