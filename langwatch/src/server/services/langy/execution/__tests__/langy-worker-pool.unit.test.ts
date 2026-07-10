import { describe, expect, it, vi } from "vitest";
import {
  LangyWorkerPool,
  type LangyTurnJobData,
} from "../langy-worker-pool";

function job(turnId: string): LangyTurnJobData {
  return {
    projectId: "proj_1",
    conversationId: `conv_${turnId}`,
    turnId,
    actorUserId: "user_1",
    prompt: "hi",
    system: "sys",
    credentials: {
      langwatchApiKey: "k",
      llmVirtualKey: "vk",
      langwatchEndpoint: "https://api",
      gatewayBaseUrl: "https://gw/v1",
      organizationId: "org_1",
    },
    permitReserved: false,
  };
}

/** A controllable spawn fn: each turn resolves only when its deferred is fired. */
function deferredSpawn() {
  const started: string[] = [];
  const resolvers = new Map<string, () => void>();
  const fn = (j: LangyTurnJobData) =>
    new Promise<void>((resolve) => {
      started.push(j.turnId);
      resolvers.set(j.turnId, resolve);
    });
  const finish = (turnId: string) => {
    resolvers.get(turnId)?.();
    resolvers.delete(turnId);
  };
  return { fn, started, finish };
}

describe("LangyWorkerPool", () => {
  describe("when a turn is submitted within the concurrency bound", () => {
    it("starts it immediately and tracks it in flight", () => {
      const pool = new LangyWorkerPool({ concurrency: 2 });
      const spawn = deferredSpawn();
      pool.setSpawnFunction(spawn.fn);

      pool.submit(job("t1"));

      expect(spawn.started).toEqual(["t1"]);
      expect(pool.activeCount).toBe(1);
      expect(pool.inFlightJobs.map((j) => j.turnId)).toEqual(["t1"]);
    });
  });

  describe("when the concurrency bound is reached", () => {
    it("buffers further turns and dequeues one when a slot frees", async () => {
      const pool = new LangyWorkerPool({ concurrency: 1 });
      const spawn = deferredSpawn();
      pool.setSpawnFunction(spawn.fn);

      pool.submit(job("t1"));
      pool.submit(job("t2"));

      // t1 running, t2 buffered.
      expect(spawn.started).toEqual(["t1"]);
      expect(pool.pendingCount).toBe(1);
      expect(pool.inFlightJobs.map((j) => j.turnId).sort()).toEqual([
        "t1",
        "t2",
      ]);

      // Complete t1 -> t2 dequeues.
      spawn.finish("t1");
      await new Promise((r) => setTimeout(r, 0));
      expect(spawn.started).toEqual(["t1", "t2"]);
      expect(pool.pendingCount).toBe(0);
    });
  });

  describe("when draining on shutdown", () => {
    it("emits a terminal failure for every in-flight and pending turn", async () => {
      const pool = new LangyWorkerPool({ concurrency: 1 });
      const spawn = deferredSpawn();
      pool.setSpawnFunction(spawn.fn);
      pool.submit(job("t1")); // running
      pool.submit(job("t2")); // pending

      const onDrain = vi.fn().mockResolvedValue(undefined);
      await pool.drain(onDrain);

      const drained = onDrain.mock.calls.map((c) => c[0].turnId).sort();
      expect(drained).toEqual(["t1", "t2"]);
      expect(pool.activeCount).toBe(0);
      expect(pool.pendingCount).toBe(0);
    });
  });

  describe("when the spawn function is not wired", () => {
    it("does not crash and leaves nothing in flight", () => {
      const pool = new LangyWorkerPool({ concurrency: 1 });
      pool.submit(job("t1"));
      expect(pool.activeCount).toBe(0);
    });
  });
});
