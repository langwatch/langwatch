/**
 * @vitest-environment node
 *
 * Redis Cluster hash-tag semantics for the scenario queue name. Redis
 * Cluster distributes keys across slots by hashing the key name; GroupQueue
 * uses multiple keys per queue, so without a {hash tag} those keys can land
 * on different slots and every multi-key Lua script fails with CROSSSLOT.
 *
 * `makeQueueName` (the wrapper function this test used to pin) is gone —
 * queue names are declared pre-wrapped as literal constants now. This keeps
 * the regression net for the declared name's shape.
 *
 * @see specs/background/redis-cluster-compatibility.feature
 */
import { describe, expect, it } from "vitest";
import { SCENARIO_QUEUE } from "../scenario-execution.constants";

/**
 * A queue name is Redis Cluster compatible when it contains a hash tag:
 * a non-empty {braced} portion that Redis hashes in place of the full key.
 */
function hasHashTag(queueName: string): boolean {
  return /\{[^}]+\}/.test(queueName);
}

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
