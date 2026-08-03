import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { QueueRedisRepository } from "../../repositories/queue.redis.repository";

let redis: Redis;
beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
});
afterAll(async () => {
  await stopTestContainers();
});

// Module-level incrementing counter for unique queue names — no Date.now() or random.
let queueCounter = 0;

describe("QueueRedisRepository.reconcileTotalPending", () => {
  let repo: QueueRedisRepository;
  let queueName: string;
  let markerKey: string;

  beforeEach(() => {
    repo = new QueueRedisRepository(redis);
    queueCounter++;
    queueName = `test-recon-${queueCounter}`;
    markerKey = `${queueName}:gq:stats:pending-recon-ts`;
  });

  describe("given the pending counter has drifted above ground truth", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile heals an over-counted pending counter to the live ground truth */
      it("heals the counter to ground truth and returns the drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupAJobsKey = `${queueName}:gq:group:groupA:jobs`;
        const groupBJobsKey = `${queueName}:gq:group:groupB:jobs`;
        const readyKey = `${queueName}:gq:ready`;

        // Clear any leftover marker from a previous run
        await redis.del(markerKey);

        // Seed: group A has 3 jobs, group B has 2 jobs → ground truth = 5
        await redis.zadd(
          groupAJobsKey,
          1000,
          "job-a1",
          1001,
          "job-a2",
          1002,
          "job-a3",
        );
        await redis.zadd(groupBJobsKey, 2000, "job-b1", 2001, "job-b2");

        // Also add both groups to the ready zset (production shape)
        await redis.zadd(readyKey, 1, "groupA", 1, "groupB");

        // SET counter = 100 (drifted well above ground truth 5)
        await redis.set(counterKey, "100");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(100);
        expect(result!.groundTruth).toBe(5);
        expect(result!.drift).toBe(95);

        // Counter must be healed to ground truth
        expect(await redis.get(counterKey)).toBe("5");
      });
    });
  });

  describe("given the counter already matches ground truth", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile returns zero drift when the counter is already accurate */
      it("returns zero drift and leaves the counter unchanged", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupJobsKey = `${queueName}:gq:group:groupX:jobs`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed: 2 jobs in one group, counter = 2 (no drift)
        await redis.zadd(groupJobsKey, 1000, "job-x1", 1001, "job-x2");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupX");
        await redis.set(counterKey, "2");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(2);
        expect(result!.groundTruth).toBe(2);
        expect(result!.drift).toBe(0);
        expect(await redis.get(counterKey)).toBe("2");
      });
    });
  });

  describe("given a reconcile already ran within the single-flight window", () => {
    describe("when reconcile runs again immediately", () => {
      /** @scenario Single-flight gate prevents a redundant reconcile within the same window */
      it("returns null on the second call and leaves the counter unchanged from the first heal", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;
        const groupJobsKey = `${queueName}:gq:group:groupY:jobs`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed: 1 job, counter = 999 (drifted)
        await redis.zadd(groupJobsKey, 1000, "job-y1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupY");
        await redis.set(counterKey, "999");

        // First call — heals the counter
        const firstResult = await repo.reconcileTotalPending(queueName);
        expect(firstResult).not.toBeNull();
        expect(await redis.get(counterKey)).toBe("1");

        // Second call — marker key should still be set, so it is skipped
        const secondResult = await repo.reconcileTotalPending(queueName);
        expect(secondResult).toBeNull();

        // Counter must be unchanged from the first heal
        expect(await redis.get(counterKey)).toBe("1");
      });
    });
  });

  describe("given the pending counter is below the actual number of jobs", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile corrects an under-counted pending counter upward to ground truth */
      it("heals the counter upward and returns negative drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed 7 jobs across groups
        await redis.zadd(
          `${queueName}:gq:group:ga:jobs`,
          1,
          "j1",
          2,
          "j2",
          3,
          "j3",
        );
        await redis.zadd(`${queueName}:gq:group:gb:jobs`, 4, "j4", 5, "j5");
        await redis.zadd(`${queueName}:gq:group:gc:jobs`, 6, "j6", 7, "j7");
        await redis.zadd(`${queueName}:gq:ready`, 1, "ga", 1, "gb", 1, "gc");

        // SET counter = 3 (under-counted)
        await redis.set(counterKey, "3");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.counter).toBe(3);
        expect(result!.groundTruth).toBe(7);
        expect(result!.drift).toBe(-4);

        // Counter must be healed upward to ground truth
        expect(await redis.get(counterKey)).toBe("7");
      });
    });
  });

  describe("given no group jobs remain in the queue", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile sets the counter to zero when no jobs remain */
      it("sets the counter to zero and returns the full positive drift", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        // Clear any leftover marker
        await redis.del(markerKey);

        // Seed NO group:*:jobs keys — queue is empty
        await redis.set(counterKey, "50");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result).not.toBeNull();
        expect(result!.groundTruth).toBe(0);
        expect(result!.drift).toBe(50);

        // Counter must be healed to zero
        expect(await redis.get(counterKey)).toBe("0");
      });
    });
  });

  describe("given groups held outside the ready set", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile counts blocked and parked groups alongside ready ones */
      it("counts the jobs of ready, blocked and parked groups", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        // A live group in ready, one held for operator triage in blocked, and
        // one deferred by the per-tenant cap into its tenant's parked set.
        await redis.zadd(`${queueName}:gq:group:tenant-a/ready:jobs`, 1, "j1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "tenant-a/ready");

        await redis.zadd(
          `${queueName}:gq:group:tenant-a/blocked:jobs`,
          1,
          "j2",
          2,
          "j3",
        );
        await redis.sadd(`${queueName}:gq:blocked`, "tenant-a/blocked");

        await redis.zadd(
          `${queueName}:gq:group:tenant-b/parked:jobs`,
          1,
          "j4",
          2,
          "j5",
          3,
          "j6",
        );
        await redis.zadd(
          `${queueName}:gq:parked:tenant-b`,
          1,
          "tenant-b/parked",
        );
        await redis.sadd(`${queueName}:gq:parked-tenants`, "tenant-b");

        await redis.set(counterKey, "0");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(6);
        expect(await redis.get(counterKey)).toBe("6");
      });
    });
  });

  describe("given a group that is in both the ready and blocked indexes", () => {
    describe("when reconcile runs", () => {
      /** @scenario Reconcile counts a group listed in two indexes only once */
      it("counts the group's jobs once", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        await redis.zadd(
          `${queueName}:gq:group:groupDup:jobs`,
          1,
          "j1",
          2,
          "j2",
        );
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupDup");
        await redis.sadd(`${queueName}:gq:blocked`, "groupDup");
        await redis.set(counterKey, "0");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(2);
      });
    });
  });

  describe("given a pass that ran past its single-flight window", () => {
    describe("when reconcile completes", () => {
      /** @scenario An overrunning reconcile releases the marker instead of holding it past the window */
      it("releases the marker so the next cycle can start immediately", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);
        await redis.zadd(`${queueName}:gq:group:groupZ:jobs`, 1, "j1");
        await redis.zadd(`${queueName}:gq:ready`, 1, "groupZ");
        await redis.set(counterKey, "9");

        // A zero-length window is the same state a pass reaches by outliving
        // its window: nothing of it remains to hand back.
        const result = await repo.reconcileTotalPending(queueName, 0);

        expect(result).not.toBeNull();
        expect(await redis.exists(markerKey)).toBe(0);

        // The next cycle is free to run rather than being told to wait.
        expect(await repo.reconcileTotalPending(queueName)).not.toBeNull();
      });
    });
  });

  describe("given a group listed only in the pending index", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A group counted from the pending index needs no lifecycle membership" */
      it("counts its jobs without it appearing in ready, blocked or parked", async () => {
        const counterKey = `${queueName}:gq:stats:total-pending`;

        await redis.del(markerKey);

        // Exactly the state a group is in while it moves between lifecycle
        // indexes: holding jobs, in none of them.
        await redis.zadd(
          `${queueName}:gq:group:tenant-a/in-flight-move:jobs`,
          1,
          "j1",
          2,
          "j2",
          3,
          "j3",
        );
        await redis.sadd(
          `${queueName}:gq:pending-groups`,
          "tenant-a/in-flight-move",
        );
        await redis.set(counterKey, "0");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(3);
        expect(await redis.get(counterKey)).toBe("3");
      });
    });
  });

  describe("given a drained group still listed in the pending index", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A drained group is dropped from the pending index" */
      it("prunes the drained group but keeps one that still holds jobs", async () => {
        const indexKey = `${queueName}:gq:pending-groups`;

        await redis.del(markerKey);

        // No jobs zset at all: the shape left behind when the safety-net TTL
        // expires a group's jobs without any script running.
        await redis.sadd(indexKey, "tenant-a/drained");
        await redis.zadd(
          `${queueName}:gq:group:tenant-a/live:jobs`,
          1,
          "still-here",
        );
        await redis.sadd(indexKey, "tenant-a/live");
        await redis.set(`${queueName}:gq:stats:total-pending`, "0");

        const result = await repo.reconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(1);
        expect((await redis.smembers(indexKey)).sort()).toEqual([
          "tenant-a/live",
        ]);
      });
    });
  });

  describe("given a group the pending index has not learned about yet", () => {
    describe("when reconcile runs", () => {
      /** @scenario "A group known only to the lifecycle indexes is adopted into the pending index" */
      it("counts it and adopts it, so later passes read it from the index", async () => {
        const indexKey = `${queueName}:gq:pending-groups`;

        await redis.del(markerKey);

        // The shape left by a pod on the previous release, or by anything staged
        // before the index existed: jobs and lifecycle membership, no index entry.
        await redis.zadd(
          `${queueName}:gq:group:legacy-group:jobs`,
          1,
          "j1",
          2,
          "j2",
        );
        await redis.zadd(`${queueName}:gq:ready`, 1, "legacy-group");
        await redis.set(`${queueName}:gq:stats:total-pending`, "0");

        expect(await redis.exists(indexKey)).toBe(0);

        const result = await repo.reconcileTotalPending(queueName);

        expect(result!.groundTruth).toBe(2);
        // Adopted, so it no longer depends on the sequential lifecycle read.
        expect(await redis.sismember(indexKey, "legacy-group")).toBe(1);
      });
    });
  });

  describe("given another instance holds the single-flight marker", () => {
    describe("when a reconcile is declined", () => {
      /** @scenario A declined reconcile leaves the holder's marker untouched */
      it("leaves the holder's marker and its expiry alone", async () => {
        await redis.set(markerKey, "other-instance-token", "PX", 30_000);

        const result = await repo.reconcileTotalPending(queueName);

        expect(result).toBeNull();
        expect(await redis.get(markerKey)).toBe("other-instance-token");
        expect(await redis.pttl(markerKey)).toBeGreaterThan(0);
      });
    });
  });
});
