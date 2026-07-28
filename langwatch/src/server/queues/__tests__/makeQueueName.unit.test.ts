/**
 * @vitest-environment node
 *
 * Redis Cluster hash-tag semantics for queue names. Redis Cluster
 * distributes keys across slots by hashing the key name; BullMQ uses
 * multiple keys per queue, so without a {hash tag} those keys can land on
 * different slots and every multi-key Lua script fails with CROSSSLOT.
 * These assertions are the regression net for queues still on BullMQ —
 * unit-level intent recovered from the deleted
 * background/__tests__/redis-cluster.integration.test.ts.
 *
 * @see specs/background/redis-cluster-compatibility.feature
 */
import { describe, expect, it } from "vitest";

import { makeQueueName } from "../makeQueueName";

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
