/**
 * Unit tests for hasNoResults — the guard that hides UI elements
 * (metrics summary, "Open Thread" button) when a scenario run
 * has not yet produced results.
 *
 * Regression: #2295 — "Open Thread" button was shown for unprocessed runs.
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { hasNoResults } from "../scenario-run-status.utils";

describe("hasNoResults", () => {
  describe("when the run is still in-flight", () => {
    it.each([
      ScenarioRunStatus.IN_PROGRESS,
      ScenarioRunStatus.PENDING,
      ScenarioRunStatus.STALLED,
      ScenarioRunStatus.CANCELLED,
    ])("returns true for %s", (status) => {
      expect(hasNoResults(status)).toBe(true);
    });
  });

  describe("when the run has reached a terminal state", () => {
    it.each([
      ScenarioRunStatus.SUCCESS,
      ScenarioRunStatus.FAILED,
      ScenarioRunStatus.ERROR,
    ])("returns false for %s", (status) => {
      expect(hasNoResults(status)).toBe(false);
    });
  });

  describe("when status is undefined", () => {
    it("returns false", () => {
      expect(hasNoResults(undefined)).toBe(false);
    });
  });
});
