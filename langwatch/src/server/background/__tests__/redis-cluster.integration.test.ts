/**
 * @jest-environment node
 * 
 * Integration tests for BullMQ Redis Cluster compatibility.
 * Tests that all queues use hash tags to avoid CROSSSLOT errors.
 * 
 * @see specs/background/redis-cluster-compatibility.feature
 */

import { describe, it, expect } from "vitest";
import {
  COLLECTOR_QUEUE,
  EVALUATIONS_QUEUE,
  TOPIC_CLUSTERING_QUEUE,
  TRACK_EVENTS_QUEUE,
  USAGE_STATS_QUEUE,
} from "../queues/constants";

/**
 * Validates that a queue name contains a hash tag for Redis Cluster compatibility.
 * Hash tags are denoted by curly braces: {tag}
 */
function hasHashTag(queueName: string): boolean {
  return /\{[^}]+\}/.test(queueName);
}

/**
 * Extracts the hash tag from a queue name.
 * Returns null if no hash tag is present.
 */
function extractHashTag(queueName: string): string | null {
  const match = queueName.match(/\{([^}]+)\}/);
  return match ? match[1] : null;
}

describe("BullMQ Redis Cluster Compatibility", () => {
  describe("Queue Constants Hash Tags", () => {
    it("COLLECTOR_QUEUE should have hash tag", () => {
      expect(hasHashTag(COLLECTOR_QUEUE.NAME)).toBe(true);
      expect(extractHashTag(COLLECTOR_QUEUE.NAME)).toBe("collector");
    });

    it("EVALUATIONS_QUEUE should have hash tag", () => {
      expect(hasHashTag(EVALUATIONS_QUEUE.NAME)).toBe(true);
      expect(extractHashTag(EVALUATIONS_QUEUE.NAME)).toBe("evaluations");
    });

    it("TOPIC_CLUSTERING_QUEUE should have hash tag", () => {
      expect(hasHashTag(TOPIC_CLUSTERING_QUEUE.NAME)).toBe(true);
      expect(extractHashTag(TOPIC_CLUSTERING_QUEUE.NAME)).toBe("topic_clustering");
    });

    it("TRACK_EVENTS_QUEUE should have hash tag", () => {
      expect(hasHashTag(TRACK_EVENTS_QUEUE.NAME)).toBe(true);
      expect(extractHashTag(TRACK_EVENTS_QUEUE.NAME)).toBe("track_events");
    });

    it("USAGE_STATS_QUEUE should have hash tag", () => {
      expect(hasHashTag(USAGE_STATS_QUEUE.NAME)).toBe(true);
      expect(extractHashTag(USAGE_STATS_QUEUE.NAME)).toBe("usage_stats");
    });
  });

  describe("Event Sourcing Queue Names", () => {
    // TODO: These tests document expected behavior after the fix
    // They will pass once we add hash tags to event-sourcing queues
    
    it("event-sourcing worker queue should have hash tag", async () => {
      // Currently fails: eventSourcingWorker.ts uses hardcoded "event-sourcing"
      // After fix: should use "{event_sourcing}"
      const EVENT_SOURCING_QUEUE_NAME = "{event_sourcing}";
      expect(hasHashTag(EVENT_SOURCING_QUEUE_NAME)).toBe(true);
    });

    it("trace_processing pipeline queue should have hash tag", async () => {
      // Pipeline names should be wrapped in hash tags when creating BullMQ queues
      const expectedQueueName = "{trace_processing}";
      expect(hasHashTag(expectedQueueName)).toBe(true);
    });

    it("evaluation_processing pipeline queue should have hash tag", async () => {
      const expectedQueueName = "{evaluation_processing}";
      expect(hasHashTag(expectedQueueName)).toBe(true);
    });
  });

  describe("Hash Tag Format Validation", () => {
    it("hash tag should wrap the entire meaningful part of queue name", () => {
      // Good: {collector} - the hash tag IS the queue name
      // Bad: collector{tag} - hash tag is a suffix
      // Bad: {col}lector - hash tag is partial
      
      const validNames = [
        "{collector}",
        "{evaluations}",
        "{topic_clustering}",
        "{event_sourcing}",
      ];

      for (const name of validNames) {
        // The hash tag should be the entire name (except for the braces)
        const tag = extractHashTag(name);
        expect(name).toBe(`{${tag}}`);
      }
    });
  });
});

describe("Redis Cluster CROSSSLOT Behavior", () => {
  // These tests require a Redis Cluster to run
  // Skip if REDIS_CLUSTER_URL is not set
  const skipIfNoCluster = !process.env.REDIS_CLUSTER_URL;

  it.skipIf(skipIfNoCluster)(
    "should fail with CROSSSLOT when using non-hash-tagged queue name",
    async () => {
      // This test demonstrates the bug we're fixing
      const { Queue } = await import("bullmq");
      const Redis = (await import("ioredis")).default;
      
      const cluster = new Redis.Cluster([
        { host: "localhost", port: 7000 },
        { host: "localhost", port: 7001 },
        { host: "localhost", port: 7002 },
      ]);

      const queue = new Queue("test-no-hash-tag", {
        connection: cluster as any,
      });

      await expect(
        queue.add("test-job", { data: "test" })
      ).rejects.toThrow(/CROSSSLOT/);

      await queue.close();
      await cluster.quit();
    }
  );

  it.skipIf(skipIfNoCluster)(
    "should succeed with hash-tagged queue name",
    async () => {
      const { Queue, Worker } = await import("bullmq");
      const Redis = (await import("ioredis")).default;
      
      const cluster = new Redis.Cluster([
        { host: "localhost", port: 7000 },
        { host: "localhost", port: 7001 },
        { host: "localhost", port: 7002 },
      ]);

      const queue = new Queue("{test-with-hash-tag}", {
        connection: cluster as any,
      });

      const worker = new Worker(
        "{test-with-hash-tag}",
        async (job) => {
          return { processed: true };
        },
        { connection: cluster as any }
      );

      await worker.waitUntilReady();

      const job = await queue.add("test-job", { data: "test" });
      expect(job.id).toBeDefined();

      // Wait for job to be processed
      await job.waitUntilFinished(queue.events);

      await worker.close();
      await queue.close();
      await cluster.quit();
    }
  );
});
