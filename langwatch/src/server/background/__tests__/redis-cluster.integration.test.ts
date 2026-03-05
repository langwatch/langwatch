/**
 * @jest-environment node
 *
 * Integration tests for BullMQ Redis Cluster compatibility.
 * Tests that all queues use hash tags to avoid CROSSSLOT errors.
 *
 * Spins up a real 6-node Redis Cluster (3 masters, 3 replicas) via
 * testcontainers to prove that:
 *   - Non-hash-tagged queue names cause CROSSSLOT errors
 *   - Hash-tagged queue names ({name}) work correctly
 *
 * @see specs/background/redis-cluster-compatibility.feature
 */

import { Queue, QueueEvents, Worker } from "bullmq";
import { Cluster } from "ioredis";
import type { StartedTestContainer } from "testcontainers";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCENARIO_QUEUE } from "../../scenarios/scenario.constants";
import {
  COLLECTOR_QUEUE,
  EVALUATIONS_QUEUE,
  TOPIC_CLUSTERING_QUEUE,
  TRACK_EVENTS_QUEUE,
  USAGE_STATS_QUEUE,
} from "../queues/constants";
import { makeQueueName } from "../queues/makeQueueName";

/**
 * Validates that a queue name contains a hash tag for Redis Cluster compatibility.
 * Hash tags are denoted by curly braces: {tag}
 */
function hasHashTag(queueName: string): boolean {
  return /\{[^}]+\}/.test(queueName);
}

// ---------------------------------------------------------------------------
// Unit: every queue name constant in the system must contain a hash tag
// ---------------------------------------------------------------------------

describe("BullMQ Redis Cluster Compatibility", () => {
  describe("when using makeQueueName", () => {
    it("wraps a name in hash tags", () => {
      expect(makeQueueName("collector")).toBe("{collector}");
    });

    it("wraps a path-style name in hash tags", () => {
      expect(makeQueueName("pipeline/handler/foo")).toBe("{pipeline/handler/foo}");
    });

    it("throws when called with an already-wrapped name", () => {
      expect(() => makeQueueName("{collector}")).toThrow(
        /already wrapped in hash tags/,
      );
    });
  });

  describe("when checking background worker queue constants", () => {
    it.each([
      ["COLLECTOR_QUEUE", COLLECTOR_QUEUE.NAME],
      ["EVALUATIONS_QUEUE", EVALUATIONS_QUEUE.NAME],
      ["TOPIC_CLUSTERING_QUEUE", TOPIC_CLUSTERING_QUEUE.NAME],
      ["TRACK_EVENTS_QUEUE", TRACK_EVENTS_QUEUE.NAME],
      ["USAGE_STATS_QUEUE", USAGE_STATS_QUEUE.NAME],
    ])("%s contains a hash tag", (_label, queueName) => {
      expect(hasHashTag(queueName)).toBe(true);
    });
  });

  describe("when checking scenario queue name", () => {
    it("SCENARIO_QUEUE contains a hash tag", () => {
      expect(hasHashTag(SCENARIO_QUEUE.NAME)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Live Redis Cluster tests — spins up a real 6-node cluster via testcontainers
// ---------------------------------------------------------------------------

const INITIAL_PORT = 17000;
const CLUSTER_PORTS = Array.from({ length: 6 }, (_, i) => INITIAL_PORT + i);

function createClusterConnection(): Cluster {
  return new Cluster(
    CLUSTER_PORTS.slice(0, 3).map((port) => ({ host: "127.0.0.1", port })),
    {
      redisOptions: { maxRetriesPerRequest: null },
    },
  );
}

describe("Redis Cluster CROSSSLOT Behavior", () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await new GenericContainer("grokzen/redis-cluster:7.0.10")
      .withEnvironment({ IP: "127.0.0.1", INITIAL_PORT: String(INITIAL_PORT) })
      .withExposedPorts(
        ...CLUSTER_PORTS.map((p) => ({ container: p, host: p })),
      )
      .withWaitStrategy(Wait.forLogMessage(/Cluster state changed: ok/))
      .withStartupTimeout(60_000)
      .withReuse()
      .start();
  }, 90_000);

  afterAll(async () => {
    // Reusable container stays running for faster subsequent runs.
    // To stop: docker rm -f $(docker ps -q --filter "label=org.testcontainers=true")
  });

  it("fails with CROSSSLOT when queue name has no hash tag", async () => {
    const connection = createClusterConnection();
    const queue = new Queue("test-no-hash-tag", {
      connection: connection as any,
    });

    try {
      await expect(
        queue.add("test-job", { data: "test" }),
      ).rejects.toThrow(/CROSSSLOT/);
    } finally {
      await queue.close();
      await connection.quit();
    }
  });

  it("succeeds when queue name has a hash tag", async () => {
    const queueConnection = createClusterConnection();
    const workerConnection = createClusterConnection();

    const queue = new Queue("{test_hash_tag}", {
      connection: queueConnection as any,
    });
    const worker = new Worker(
      "{test_hash_tag}",
      async () => ({ processed: true }),
      { connection: workerConnection as any },
    );

    try {
      await worker.waitUntilReady();

      const job = await queue.add("test-job", { data: "test" });
      expect(job.id).toBeDefined();

      const eventsConnection = createClusterConnection();
      const queueEvents = new QueueEvents("{test_hash_tag}", {
        connection: eventsConnection as any,
      });

      const result = await job.waitUntilFinished(queueEvents, 10_000);
      expect(result).toEqual({ processed: true });

      await queueEvents.close();
      await eventsConnection.quit();
    } finally {
      await worker.close();
      await queue.close();
      await workerConnection.quit();
      await queueConnection.quit();
    }
  });
});
