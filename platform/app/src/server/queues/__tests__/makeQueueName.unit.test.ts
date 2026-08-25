/**
 * @vitest-environment node
 *
 * Redis Cluster hash-tag semantics for queue names. Redis Cluster
 * distributes keys across slots by hashing the key name; GroupQueue uses
 * multiple keys per queue, so without a {hash tag} those keys can land on
 * different slots and every multi-key Lua script fails with CROSSSLOT.
 * These assertions are the regression net for every declared queue name.
 *
 * @see specs/background/redis-cluster-compatibility.feature
 */
import { describe, expect, it } from "vitest";
import { SCENARIO_QUEUE } from "~/server/scenarios/scenario.constants";
import { makeQueueName } from "../makeQueueName";

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
      expect(makeQueueName("pipeline/handler/foo")).toBe("{pipeline/handler/foo}");
    });
  });

  describe("when called with an already-wrapped name", () => {
    it("throws to prevent double-wrapping", () => {
      expect(() => makeQueueName("{collector}")).toThrow(/already wrapped in hash tags/);
    });
  });
});

describe("queue name constants", () => {
  describe("when checking every declared queue name", () => {
    /** @scenario Every queue name produced by the system contains a hash tag */
    it.each([["SCENARIO_QUEUE", SCENARIO_QUEUE.NAME]])(
      "%s contains a hash tag",
      (_label, queueName) => {
        expect(hasHashTag(queueName)).toBe(true);
      },
    );
  });
});
