/**
 * Integration tests for the queue name migration script.
 *
 * Seeds Redis with BullMQ jobs under old (pre-hash-tag) queue names,
 * verifies the migration logic discovers them, moves them to new
 * hash-tagged queues, and cleans up old keys — without touching
 * new keys.
 *
 * Uses standalone Redis from testcontainers. BullMQ works fine on
 * standalone without hash tags, so we can seed old queues directly.
 *
 * @see scripts/migrate-queue-names.ts
 * @see specs/background/redis-cluster-compatibility.feature
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  getTestRedisConnection,
  startTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import {
  OLD_QUEUE_PATTERNS,
  STATIC_QUEUE_MAPPING,
  scanKeys,
  cleanupKeys,
  readJobIds,
  readJobData,
  moveJobs,
  buildQueueMapping,
} from "../../../../scripts/migrate-queue-names";

/**
 * Given an old queue pattern, returns a concrete key name that matches it.
 *
 * Pipeline patterns use "/" separator: "bull:trace_processing/*"
 *   → "bull:trace_processing/handler/test:wait"
 * Standard patterns use ":" separator: "bull:collector:*"
 *   → "bull:collector:wait"
 */
function concreteKeyFromPattern(pattern: string): string {
  if (pattern.endsWith("/*")) {
    return pattern.replace("/*", "/handler/test:wait");
  }
  return pattern.replace(":*", ":wait");
}

/** Helper to create a BullMQ queue for seeding/reading jobs in tests. */
function createTestQueue(name: string, redis: IORedis): Queue {
  return new Queue(name, { connection: redis as any });
}

describe("Queue Name Migration Script", () => {
  let redis: IORedis;
  const queuesToClose: Queue[] = [];

  beforeEach(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
    if (!redis) throw new Error("Redis connection not available");
    await redis.flushall();
  });

  afterEach(async () => {
    for (const q of queuesToClose) {
      await q.close().catch(() => {});
    }
    queuesToClose.length = 0;
  });

  // -----------------------------------------------------------------------
  // Scanning
  // -----------------------------------------------------------------------

  describe("when scanning for old keys", () => {
    it("finds keys matching each old pattern", async () => {
      for (const pattern of OLD_QUEUE_PATTERNS) {
        await redis.set(concreteKeyFromPattern(pattern), "orphaned");
      }

      for (const pattern of OLD_QUEUE_PATTERNS) {
        const found = await scanKeys(redis, pattern);
        expect(found.length).toBeGreaterThan(0);
        expect(found).toContain(concreteKeyFromPattern(pattern));
      }
    });

    it("returns empty when only new hash-tagged keys exist", async () => {
      await redis.set("bull:{collector}:wait", "active");
      await redis.set("bull:{event_sourcing}:wait", "active");

      for (const pattern of OLD_QUEUE_PATTERNS) {
        const found = await scanKeys(redis, pattern);
        expect(found).toHaveLength(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Reading jobs from old queues
  // -----------------------------------------------------------------------

  describe("when reading jobs from an old queue", () => {
    it("reads job IDs from a BullMQ queue seeded under the old name", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "abc123" });
      await oldQueue.add("trace", { traceId: "def456" });

      const jobIds = await readJobIds(redis, "collector");
      expect(jobIds).toHaveLength(2);
    });

    it("reads job data including name and payload", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      const addedJob = await oldQueue.add("trace", {
        traceId: "abc123",
        spans: [1, 2, 3],
      });

      const jobData = await readJobData(redis, "collector", addedJob.id!);
      expect(jobData).not.toBeNull();
      expect(jobData!.name).toBe("trace");
      expect(jobData!.data).toEqual({ traceId: "abc123", spans: [1, 2, 3] });
    });

    it("returns null for a non-existent job ID", async () => {
      const jobData = await readJobData(redis, "collector", "99999");
      expect(jobData).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Moving jobs
  // -----------------------------------------------------------------------

  describe("when moving jobs from old to new queue", () => {
    it("moves all waiting jobs to the new hash-tagged queue", async () => {
      // Seed 3 jobs into old "collector" queue
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "1" });
      await oldQueue.add("trace", { traceId: "2" });
      await oldQueue.add("trace", { traceId: "3" });

      // Move them
      const moved = await moveJobs(redis, "collector", "{collector}");
      expect(moved).toBe(3);

      // Verify they exist in the new queue
      const newQueue = createTestQueue("{collector}", redis);
      queuesToClose.push(newQueue);

      const waiting = await newQueue.getWaiting();
      expect(waiting).toHaveLength(3);

      const payloads = waiting.map((j) => j.data);
      expect(payloads).toContainEqual({ traceId: "1" });
      expect(payloads).toContainEqual({ traceId: "2" });
      expect(payloads).toContainEqual({ traceId: "3" });
    });

    it("preserves the job name during migration", async () => {
      const oldQueue = createTestQueue("evaluations", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("custom-evaluator", { check: true });

      await moveJobs(redis, "evaluations", "{evaluations}");

      const newQueue = createTestQueue("{evaluations}", redis);
      queuesToClose.push(newQueue);

      const [job] = await newQueue.getWaiting();
      expect(job!.name).toBe("custom-evaluator");
      expect(job!.data).toEqual({ check: true });
    });

    it("handles the event-sourcing hyphen-to-underscore rename", async () => {
      const oldQueue = createTestQueue("event-sourcing", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("maintenance", { action: "health_check" });

      // Old name uses hyphen, new name uses underscore
      await moveJobs(redis, "event-sourcing", "{event_sourcing}");

      const newQueue = createTestQueue("{event_sourcing}", redis);
      queuesToClose.push(newQueue);

      const [job] = await newQueue.getWaiting();
      expect(job!.name).toBe("maintenance");
      expect(job!.data).toEqual({ action: "health_check" });
    });

    it("returns 0 when old queue has no jobs", async () => {
      const moved = await moveJobs(redis, "collector", "{collector}");
      expect(moved).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // End-to-end: migrate + cleanup
  // -----------------------------------------------------------------------

  describe("when running full migration (move + cleanup)", () => {
    it("moves jobs and cleans up old keys without touching new keys", async () => {
      // Seed jobs into two old queues
      const oldCollector = createTestQueue("collector", redis);
      const oldEval = createTestQueue("evaluations", redis);
      queuesToClose.push(oldCollector, oldEval);

      await oldCollector.add("trace", { id: "t1" });
      await oldEval.add("eval", { id: "e1" });

      // Also seed a new hash-tagged queue (should be untouched)
      const existingNew = createTestQueue("{track_events}", redis);
      queuesToClose.push(existingNew);
      await existingNew.add("event", { id: "existing" });

      // Step 1: Build mapping and move jobs
      const mapping = await buildQueueMapping(redis);
      expect(mapping).toHaveProperty("collector", "{collector}");
      expect(mapping).toHaveProperty("evaluations", "{evaluations}");

      for (const [oldName, newName] of Object.entries(mapping)) {
        await moveJobs(redis, oldName, newName);
      }

      // Step 2: Cleanup old keys
      const allOldKeys: string[] = [];
      for (const pattern of OLD_QUEUE_PATTERNS) {
        allOldKeys.push(...(await scanKeys(redis, pattern)));
      }
      await cleanupKeys(redis, allOldKeys);

      // Verify: old queues are empty
      const oldCollectorKeys = await scanKeys(redis, "bull:collector:*");
      expect(oldCollectorKeys).toHaveLength(0);

      // Verify: new queues have the migrated jobs
      const newCollector = createTestQueue("{collector}", redis);
      queuesToClose.push(newCollector);
      const collectorJobs = await newCollector.getWaiting();
      expect(collectorJobs).toHaveLength(1);
      expect(collectorJobs[0]!.data).toEqual({ id: "t1" });

      // Verify: pre-existing new queue is untouched
      const trackJobs = await existingNew.getWaiting();
      expect(trackJobs).toHaveLength(1);
      expect(trackJobs[0]!.data).toEqual({ id: "existing" });
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup only (no move)
  // -----------------------------------------------------------------------

  describe("when cleaning up without migration", () => {
    it("deletes all BullMQ key types for a queue", async () => {
      const suffixes = [
        "wait", "active", "completed", "failed",
        "delayed", "paused", "stalled", "meta",
        "id", "events",
      ];
      const keys = suffixes.map((s) => `bull:collector:${s}`);
      for (const key of keys) {
        await redis.set(key, "data");
      }

      const found = await scanKeys(redis, "bull:collector:*");
      expect(found.length).toBe(suffixes.length);

      await cleanupKeys(redis, found);
      for (const key of keys) {
        expect(await redis.exists(key)).toBe(0);
      }
    });
  });
});
