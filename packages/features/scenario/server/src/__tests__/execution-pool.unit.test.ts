/**
 * Unit tests for ScenarioExecutionPoolService.
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import { ChildProcess } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionJobData } from "../index";
import { ScenarioExecutionPoolService, ScenarioExecutionRunnerPort } from "../index";

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

let nextChildPid = 1;

function makeFakeChild(): { child: ChildProcess; kill: ReturnType<typeof vi.fn> } {
  const child = new ChildProcess();
  const kill = vi.fn(() => true);
  child.kill = kill;
  Object.defineProperty(child, "pid", { value: nextChildPid++ });
  return { child, kill };
}

class TestScenarioExecutionRunner extends ScenarioExecutionRunnerPort {
  readonly skipped: ExecutionJobData[] = [];

  constructor(private readonly executeJob: (jobData: ExecutionJobData) => Promise<void>) {
    super();
  }

  execute(jobData: ExecutionJobData): Promise<void> {
    return this.executeJob(jobData);
  }

  skipCancelled(jobData: ExecutionJobData): void {
    this.skipped.push(jobData);
  }
}

describe("ScenarioExecutionPoolService", () => {
  let pool: ScenarioExecutionPoolService;
  let spawnedJobs: ExecutionJobData[];
  let childKills: Map<string, ReturnType<typeof vi.fn>>;
  let runner: TestScenarioExecutionRunner;

  beforeEach(() => {
    spawnedJobs = [];
    childKills = new Map();
    pool = ScenarioExecutionPoolService.create({ concurrency: 2 });
    runner = new TestScenarioExecutionRunner(async (jobData) => {
      spawnedJobs.push(jobData);
      // Simulate: register child, then "run" until deregistered
      const fake = makeFakeChild();
      childKills.set(jobData.scenarioRunId, fake.kill);
      pool.registerChild(jobData.scenarioRunId, fake.child);
    });
    pool.connect(runner);
  });

  describe("when pool has capacity", () => {
    it("starts the job immediately", () => {
      pool.submit(makeJob("run-1"));
      expect(spawnedJobs).toHaveLength(1);
      expect(spawnedJobs[0]!.scenarioRunId).toBe("run-1");
    });

    it("ignores a redelivered job while the original is in flight", () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-1"));

      expect(spawnedJobs).toHaveLength(1);
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

    it("ignores a redelivered job while the original is pending", () => {
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3"));
      pool.submit(makeJob("run-3"));

      expect(pool.pendingCount).toBe(1);
      expect(pool.inFlightJobs.map((job) => job.scenarioRunId)).toEqual([
        "run-1",
        "run-2",
        "run-3",
      ]);
    });

    it("counts jobs as active before their children are registered", () => {
      const delayedPool = ScenarioExecutionPoolService.create({ concurrency: 2 });
      const execute = vi.fn(() => new Promise<void>(() => {}));
      delayedPool.connect(new TestScenarioExecutionRunner(execute));

      delayedPool.submit(makeJob("run-1"));
      delayedPool.submit(makeJob("run-2"));
      delayedPool.submit(makeJob("run-3"));

      expect(execute).toHaveBeenCalledTimes(2);
      expect(delayedPool.activeCount).toBe(2);
      expect(delayedPool.pendingCount).toBe(1);
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

  it("throws before accepting work when no runner is connected", () => {
    const disconnected = ScenarioExecutionPoolService.create({ concurrency: 1 });

    expect(() => disconnected.submit(makeJob("run-1"))).toThrow(/not connected.*run-1/);
    expect(disconnected.inFlightJobs).toEqual([]);
  });

  describe("when a cancelled job is submitted", () => {
    it("skips the job entirely", () => {
      pool.markCancelled("run-1");
      pool.submit(makeJob("run-1"));

      expect(spawnedJobs).toHaveLength(0);
    });

    it("calls onSkipCancelled so the terminal event is written", () => {
      pool.markCancelled("run-1");
      pool.submit(makeJob("run-1"));

      expect(runner.skipped).toHaveLength(1);
      expect(runner.skipped[0]?.scenarioRunId).toBe("run-1");
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
      pool.submit(makeJob("run-1"));
      pool.submit(makeJob("run-2"));
      pool.submit(makeJob("run-3")); // pending

      pool.markCancelled("run-3");
      pool.deregisterChild("run-1");
      await new Promise((r) => setTimeout(r, 10));

      expect(runner.skipped).toHaveLength(1);
      expect(runner.skipped[0]?.scenarioRunId).toBe("run-3");
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

      pool.drain();

      expect(pool.pendingCount).toBe(0);
      expect(childKills.get("run-1")).toHaveBeenCalledWith("SIGTERM");
      expect(childKills.get("run-2")).toHaveBeenCalledWith("SIGTERM");
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
        expect(inFlightIds).toEqual(expect.arrayContaining(["run-1", "run-2", "run-3"]));
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
