/**
 * Integration tests for event-sourcing based scenario cancellation.
 *
 * Uses real Redis (via testContainers) to verify the full pub/sub flow:
 * - Publishing cancel signals from the reactor
 * - Workers subscribing and receiving targeted cancellations
 * - Multiple workers only killing their own children
 * - Batch cancellation reaching all workers
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
  getTestRedisConnection,
} from "../../event-sourcing/__tests__/integration/testContainers";
import {
  publishCancellation,
  subscribeToCancellations,
} from "../cancellation-channel";
import type { CancellationMessage, CancellationSubscriber } from "../cancellation-channel";
import type { Redis } from "ioredis";

/** Poll until condition is true, or throw on timeout. */
async function waitFor(condition: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Simulates a worker pod with a set of "running" child processes.
 * Each child tracks whether it received a kill signal.
 */
function createMockWorker(redis: Redis) {
  const killed = new Map<string, boolean>();
  const running = new Map<string, { kill: (signal: string) => void }>();

  function startChild(scenarioRunId: string) {
    killed.set(scenarioRunId, false);
    running.set(scenarioRunId, {
      kill: (_signal: string) => {
        killed.set(scenarioRunId, true);
        running.delete(scenarioRunId);
      },
    });
  }

  return {
    killed,
    running,
    startChild,
    /** Creates a subscriber and wires cancellation handling */
    async subscribe() {
      const subscriber = redis.duplicate() as unknown as CancellationSubscriber;
      const unsubscribe = await subscribeToCancellations({
        subscriber,
        onCancel: (message: CancellationMessage) => {
          const child = running.get(message.scenarioRunId);
          if (child) {
            child.kill("SIGTERM");
          }
        },
      });
      return unsubscribe;
    },
  };
}

describe("Event-sourcing cancellation (real Redis)", () => {
  let redis: Redis;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    await startTestContainers();
    const conn = getTestRedisConnection();
    if (!conn) throw new Error("Redis not available for integration tests");
    redis = conn;
  }, 30_000);

  afterAll(async () => {
    await stopTestContainers();
  });

  afterEach(async () => {
    // Clean up all subscriptions
    for (const fn of cleanupFns) {
      await fn().catch(() => {});
    }
    cleanupFns.length = 0;
  });

  describe("when a single worker is running a scenario", () => {
    it("kills the child process on cancel broadcast", async () => {
      const worker = createMockWorker(redis);
      worker.startChild("run-1");
      const unsubscribe = await worker.subscribe();
      cleanupFns.push(unsubscribe);

      // Give Redis time to process the subscription
      await new Promise((r) => setTimeout(r, 50));

      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-1", batchRunId: "batch-1" },
      });

      await waitFor(() => worker.killed.get("run-1") === true);
      expect(worker.killed.get("run-1")).toBe(true);
    });
  });

  describe("when multiple workers run different scenarios", () => {
    it("only the worker running the target scenario kills its child", async () => {
      const workerA = createMockWorker(redis);
      workerA.startChild("run-A1");
      workerA.startChild("run-A2");
      const unsubA = await workerA.subscribe();
      cleanupFns.push(unsubA);

      const workerB = createMockWorker(redis);
      workerB.startChild("run-B1");
      const unsubB = await workerB.subscribe();
      cleanupFns.push(unsubB);

      await new Promise((r) => setTimeout(r, 50));

      // Cancel only run-A1
      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-A1", batchRunId: "batch-1" },
      });

      await waitFor(() => workerA.killed.get("run-A1") === true);

      // Worker A: run-A1 killed, run-A2 untouched
      expect(workerA.killed.get("run-A1")).toBe(true);
      expect(workerA.killed.get("run-A2")).toBe(false);

      // Worker B: run-B1 untouched
      expect(workerB.killed.get("run-B1")).toBe(false);
    });
  });

  describe("when a batch cancel fires for multiple scenarios", () => {
    it("all matching child processes across workers are killed", async () => {
      const workerA = createMockWorker(redis);
      workerA.startChild("run-1");
      workerA.startChild("run-2");
      const unsubA = await workerA.subscribe();
      cleanupFns.push(unsubA);

      const workerB = createMockWorker(redis);
      workerB.startChild("run-3");
      const unsubB = await workerB.subscribe();
      cleanupFns.push(unsubB);

      await new Promise((r) => setTimeout(r, 50));

      // Cancel all 3 runs (simulates batch cancel dispatching 3 events)
      await Promise.all([
        publishCancellation({
          publisher: redis,
          message: { projectId: "proj-1", scenarioRunId: "run-1", batchRunId: "batch-1" },
        }),
        publishCancellation({
          publisher: redis,
          message: { projectId: "proj-1", scenarioRunId: "run-2", batchRunId: "batch-1" },
        }),
        publishCancellation({
          publisher: redis,
          message: { projectId: "proj-1", scenarioRunId: "run-3", batchRunId: "batch-1" },
        }),
      ]);

      await waitFor(() =>
        workerA.killed.get("run-1") === true &&
        workerA.killed.get("run-2") === true &&
        workerB.killed.get("run-3") === true,
      );

      expect(workerA.killed.get("run-1")).toBe(true);
      expect(workerA.killed.get("run-2")).toBe(true);
      expect(workerB.killed.get("run-3")).toBe(true);
    });
  });

  describe("when no worker is running the cancelled scenario", () => {
    it("no workers take any action", async () => {
      const workerA = createMockWorker(redis);
      workerA.startChild("run-other");
      const unsubA = await workerA.subscribe();
      cleanupFns.push(unsubA);

      await new Promise((r) => setTimeout(r, 50));

      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-nonexistent", batchRunId: "batch-1" },
      });

      // Give time for message delivery — if it were going to kill, it would by now
      await new Promise((r) => setTimeout(r, 100));

      expect(workerA.killed.get("run-other")).toBe(false);
      expect(workerA.running.size).toBe(1); // Still running
    });
  });

  describe("when cancel arrives for an already-killed child", () => {
    it("handles idempotently without errors", async () => {
      const workerA = createMockWorker(redis);
      workerA.startChild("run-1");
      const unsubA = await workerA.subscribe();
      cleanupFns.push(unsubA);

      await new Promise((r) => setTimeout(r, 50));

      // First cancel
      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-1", batchRunId: "batch-1" },
      });

      await waitFor(() => workerA.killed.get("run-1") === true);
      expect(workerA.killed.get("run-1")).toBe(true);

      // Second cancel for same run (idempotent — child already removed from running map)
      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-1", batchRunId: "batch-1" },
      });

      // Give time for the no-op delivery
      await new Promise((r) => setTimeout(r, 100));
      // No error thrown, still killed
      expect(workerA.killed.get("run-1")).toBe(true);
    });
  });

  describe("when a worker subscribes after a cancel was published", () => {
    it("does not receive the old cancel (pub/sub is fire-and-forget)", async () => {
      // Publish cancel BEFORE any worker subscribes
      await publishCancellation({
        publisher: redis,
        message: { projectId: "proj-1", scenarioRunId: "run-late", batchRunId: "batch-1" },
      });

      await new Promise((r) => setTimeout(r, 50));

      // Worker subscribes AFTER the cancel was published
      const workerA = createMockWorker(redis);
      workerA.startChild("run-late");
      const unsubA = await workerA.subscribe();
      cleanupFns.push(unsubA);

      // Give time — if old cancel were delivered, it would be by now
      await new Promise((r) => setTimeout(r, 100));

      // Worker should NOT have received the old cancel
      expect(workerA.killed.get("run-late")).toBe(false);
    });
  });
});
