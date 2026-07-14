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
        await redis.zadd(groupAJobsKey, 1000, "job-a1", 1001, "job-a2", 1002, "job-a3");
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
        await redis.zadd(`${queueName}:gq:group:ga:jobs`, 1, "j1", 2, "j2", 3, "j3");
        await redis.zadd(`${queueName}:gq:group:gb:jobs`, 4, "j4", 5, "j5");
        await redis.zadd(`${queueName}:gq:group:gc:jobs`, 6, "j6", 7, "j7");

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
});
