/**
 * Unit tests for stalled job retry behavior.
 * @see specs/scenarios/scenario-failure-handler.feature "Stalled jobs fail without retry"
 */

import { describe, expect, it } from "vitest";
import { SCENARIO_QUEUE } from "../scenario.constants";

describe("Stalled jobs fail without retry", () => {
  describe("given a scenario job has stalled", () => {
    describe("when BullMQ processes the stalled job", () => {
      it("fails immediately with no retry attempted", () => {
        // The queue is configured with attempts=1, meaning after a job stalls
        // and is detected, it transitions directly to failed state without retry
        expect(SCENARIO_QUEUE.MAX_ATTEMPTS).toBe(1);
      });
    });
  });
});
