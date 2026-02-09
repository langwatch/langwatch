/**
 * Integration tests for the queue name migration script.
 *
 * Seeds Redis with BullMQ jobs under old (pre-hash-tag) queue names,
 * verifies the migration logic discovers them, copies them to new
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
  MIGRATION_TRACKER_KEY,
  scanKeys,
  cleanupKeys,
  readJobIds,
  readJobData,
  copyJobs,
  migrationTrackerId,
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
  // Copying jobs (safe, no deletion)
  // -----------------------------------------------------------------------

  describe("when copying jobs from old to new queue", () => {
    it("copies all waiting jobs to the new hash-tagged queue", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "1" });
      await oldQueue.add("trace", { traceId: "2" });
      await oldQueue.add("trace", { traceId: "3" });

      const result = await copyJobs(redis, "collector", "{collector}");
      expect(result.copied).toBe(3);
      expect(result.failed).toHaveLength(0);

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

      await copyJobs(redis, "evaluations", "{evaluations}");

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

      await copyJobs(redis, "event-sourcing", "{event_sourcing}");

      const newQueue = createTestQueue("{event_sourcing}", redis);
      queuesToClose.push(newQueue);

      const [job] = await newQueue.getWaiting();
      expect(job!.name).toBe("maintenance");
      expect(job!.data).toEqual({ action: "health_check" });
    });

    it("leaves old queue keys intact after copying", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "keep-me" });

      await copyJobs(redis, "collector", "{collector}");

      // Old keys should still exist
      const oldKeys = await scanKeys(redis, "bull:collector:*");
      expect(oldKeys.length).toBeGreaterThan(0);

      // Old job data should still be readable
      const jobIds = await readJobIds(redis, "collector");
      expect(jobIds).toHaveLength(1);
    });

    it("returns 0 when old queue has no jobs", async () => {
      const result = await copyJobs(redis, "collector", "{collector}");
      expect(result.copied).toBe(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Idempotency — re-running migration is safe
  // -----------------------------------------------------------------------

  describe("when running migration twice (idempotency)", () => {
    it("skips already-copied jobs on re-run", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "1" });
      await oldQueue.add("trace", { traceId: "2" });

      // First run — copies both jobs
      const result1 = await copyJobs(redis, "collector", "{collector}");
      expect(result1.copied).toBe(2);
      expect(result1.alreadyCopied).toBe(0);

      // Second run — tracker set recognizes them as already copied
      const result2 = await copyJobs(redis, "collector", "{collector}");
      expect(result2.copied).toBe(0);
      expect(result2.alreadyCopied).toBe(2);

      // New queue should still have exactly 2 jobs, not 4
      const newQueue = createTestQueue("{collector}", redis);
      queuesToClose.push(newQueue);

      const waiting = await newQueue.getWaiting();
      expect(waiting).toHaveLength(2);
    });

    it("survives job completion — no duplicates even after workers process the jobs", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "1" });

      // First run — copies the job
      const result1 = await copyJobs(redis, "collector", "{collector}");
      expect(result1.copied).toBe(1);

      // Simulate worker completing and removing the job from the new queue
      const newQueue = createTestQueue("{collector}", redis);
      queuesToClose.push(newQueue);
      const [job] = await newQueue.getWaiting();
      await job!.remove();

      // Verify the job is actually gone from the new queue
      const waitingAfterRemove = await newQueue.getWaiting();
      expect(waitingAfterRemove).toHaveLength(0);

      // Re-run migration — tracker set prevents re-copying
      const result2 = await copyJobs(redis, "collector", "{collector}");
      expect(result2.copied).toBe(0);
      expect(result2.alreadyCopied).toBe(1);

      // Still 0 in queue — NOT re-created
      const waitingAfterRerun = await newQueue.getWaiting();
      expect(waitingAfterRerun).toHaveLength(0);
    });

    it("generates deterministic tracker IDs", () => {
      const id1 = migrationTrackerId("collector", "42");
      const id2 = migrationTrackerId("collector", "42");
      expect(id1).toBe(id2);
      expect(id1).toBe("collector:42");
    });

    it("records copied jobs in the tracker set", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);

      await oldQueue.add("trace", { traceId: "1" });

      await copyJobs(redis, "collector", "{collector}");

      // Verify the tracker set has the entry
      const members = await redis.smembers(MIGRATION_TRACKER_KEY);
      expect(members.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // End-to-end: copy + verify + cleanup
  // -----------------------------------------------------------------------

  describe("when running full two-step migration", () => {
    it("copies jobs, then cleanup removes old keys without touching new keys", async () => {
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

      // Step 1: Copy jobs (no deletion)
      const mapping = await buildQueueMapping(redis);
      for (const [oldName, newName] of Object.entries(mapping)) {
        await copyJobs(redis, oldName, newName);
      }

      // Verify old keys still exist
      const oldCollectorKeys = await scanKeys(redis, "bull:collector:*");
      expect(oldCollectorKeys.length).toBeGreaterThan(0);

      // Verify new queues have the copied jobs
      const newCollector = createTestQueue("{collector}", redis);
      queuesToClose.push(newCollector);
      const collectorJobs = await newCollector.getWaiting();
      expect(collectorJobs).toHaveLength(1);
      expect(collectorJobs[0]!.data).toEqual({ id: "t1" });

      // Step 2: Cleanup old keys
      const allOldKeys: string[] = [];
      for (const pattern of OLD_QUEUE_PATTERNS) {
        allOldKeys.push(...(await scanKeys(redis, pattern)));
      }
      await cleanupKeys(redis, allOldKeys);

      // Old keys should be gone
      const afterCleanup = await scanKeys(redis, "bull:collector:*");
      expect(afterCleanup).toHaveLength(0);

      // New queues should still have the jobs
      const stillThere = await newCollector.getWaiting();
      expect(stillThere).toHaveLength(1);

      // Pre-existing new queue is untouched
      const trackJobs = await existingNew.getWaiting();
      expect(trackJobs).toHaveLength(1);
      expect(trackJobs[0]!.data).toEqual({ id: "existing" });
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup only
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Pipeline queue discovery
  // -----------------------------------------------------------------------

  describe("when discovering pipeline queues", () => {
    it("includes dynamically-named pipeline queues in the mapping", async () => {
      // Seed a pipeline queue meta key (BullMQ creates :meta for every queue)
      await redis.set(
        "bull:trace_processing/handler/ingestTrace:meta",
        '{"opts":{}}',
      );
      await redis.set(
        "bull:evaluation_processing/projection/evalState:meta",
        '{"opts":{}}',
      );

      const mapping = await buildQueueMapping(redis);

      // Static queues should be present
      expect(mapping).toHaveProperty("collector", "{collector}");

      // Dynamic pipeline queues should be discovered
      expect(mapping).toHaveProperty(
        "trace_processing/handler/ingestTrace",
        "{trace_processing/handler/ingestTrace}",
      );
      expect(mapping).toHaveProperty(
        "evaluation_processing/projection/evalState",
        "{evaluation_processing/projection/evalState}",
      );
    });

    it("returns only static queues when no pipeline meta keys exist", async () => {
      const mapping = await buildQueueMapping(redis);
      expect(Object.keys(mapping)).toEqual(
        Object.keys(STATIC_QUEUE_MAPPING),
      );
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
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

  describe("when cleaning up after migration", () => {
    it("removes the migration tracker set along with old keys", async () => {
      const oldQueue = createTestQueue("collector", redis);
      queuesToClose.push(oldQueue);
      await oldQueue.add("trace", { traceId: "1" });

      // Copy jobs (populates tracker set)
      await copyJobs(redis, "collector", "{collector}");
      expect(await redis.scard(MIGRATION_TRACKER_KEY)).toBeGreaterThan(0);

      // Cleanup old keys
      const oldKeys = await scanKeys(redis, "bull:collector:*");
      await cleanupKeys(redis, oldKeys);

      // Remove tracker (as --cleanup does)
      await redis.unlink(MIGRATION_TRACKER_KEY);

      // Tracker set should be gone
      expect(await redis.exists(MIGRATION_TRACKER_KEY)).toBe(0);

      // Old keys should be gone
      expect(await scanKeys(redis, "bull:collector:*")).toHaveLength(0);

      // New queue should still have the job
      const newQueue = createTestQueue("{collector}", redis);
      queuesToClose.push(newQueue);
      expect(await newQueue.getWaiting()).toHaveLength(1);
    });
  });
});
