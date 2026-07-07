/**
 * @vitest-environment node
 *
 * Redis Cluster hash-tag semantics for queue names. Redis Cluster
 * distributes keys across slots by hashing the key name; BullMQ uses
 * multiple keys per queue, so without a {hash tag} those keys can land on
 * different slots and every multi-key Lua script fails with CROSSSLOT.
 * These assertions are the regression net for the queues that still run on
 * BullMQ in production (topic clustering, ingestion puller, scenarios) —
 * unit-level intent recovered from the deleted
 * background/__tests__/redis-cluster.integration.test.ts.
 *
 * @see specs/background/redis-cluster-compatibility.feature
 */
import { describe, expect, it, vi } from "vitest";

import { makeQueueName } from "../makeQueueName";
import { SCENARIO_QUEUE } from "~/server/scenarios/scenario.constants";
import { TOPIC_CLUSTERING_QUEUE } from "~/server/topicClustering/topicClusteringQueue.constants";

// PULLER_QUEUE lives in the puller worker module, whose transitive imports
// touch Prisma / Redis / ClickHouse at load — stub those storage edges so
// reading the constant stays a unit test.
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/redis", () => ({ connection: null }));
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

import { PULLER_QUEUE } from "@ee/governance/services/pullers/pullerWorker";

/**
 * A queue name is Redis Cluster compatible when it contains a hash tag:
 * a non-empty {braced} portion that Redis hashes in place of the full key.
 */
function hasHashTag(queueName: string): boolean {
  return /\{[^}]+\}/.test(queueName);
}

describe("makeQueueName", () => {
  describe("when wrapping plain names", () => {
    /** @scenario Every queue name produced by the system contains a hash tag */
    it("wraps a name in hash tags", () => {
      expect(makeQueueName("collector")).toBe("{collector}");
    });

    it("wraps a path-style name in hash tags", () => {
      expect(makeQueueName("pipeline/handler/foo")).toBe(
        "{pipeline/handler/foo}",
      );
    });
  });

  describe("when called with an already-wrapped name", () => {
    it("throws to prevent double-wrapping", () => {
      expect(() => makeQueueName("{collector}")).toThrow(
        /already wrapped in hash tags/,
      );
    });
  });
});

describe("queue name constants", () => {
  describe("when checking every queue that runs on BullMQ", () => {
    /** @scenario Every queue name produced by the system contains a hash tag */
    it.each([
      ["TOPIC_CLUSTERING_QUEUE", TOPIC_CLUSTERING_QUEUE.NAME],
      ["PULLER_QUEUE", PULLER_QUEUE.NAME],
      ["SCENARIO_QUEUE", SCENARIO_QUEUE.NAME],
    ])("%s contains a hash tag", (_label, queueName) => {
      expect(hasHashTag(queueName)).toBe(true);
    });
  });
});
