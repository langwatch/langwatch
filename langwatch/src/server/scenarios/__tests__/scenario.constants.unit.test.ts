/**
 * Unit tests for scenario constants.
 * @see specs/scenarios/scenario-failure-handler.feature "Stalled job configuration prevents retries"
 */

import { describe, expect, it } from "vitest";
import { SCENARIO_QUEUE } from "../scenario.constants";

describe("SCENARIO_QUEUE constants", () => {
  describe("MAX_ATTEMPTS", () => {
    it("equals 1 to prevent retries after stall detection", () => {
      // Given: a scenario worker is configured with job options
      // When: the worker options are inspected
      // Then: MAX_ATTEMPTS equals 1 so the job will fail after first stall detection
      expect(SCENARIO_QUEUE.MAX_ATTEMPTS).toBe(1);
    });
  });
});
