/**
 * @vitest-environment node
 * Queue names must have Redis Cluster hash tags for CROSSSLOT avoidance.
 */
import { describe, expect, it } from "vitest";

import { SCENARIO_QUEUE } from "../scenario-execution.constants.ts";

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
