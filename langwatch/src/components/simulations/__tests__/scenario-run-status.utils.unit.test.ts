import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { hasNoResults } from "../scenario-run-status.utils";

// Regression: #2295
describe("hasNoResults()", () => {
  describe("when the run is still in-flight or cancelled", () => {
    it.each([
      ScenarioRunStatus.IN_PROGRESS,
      ScenarioRunStatus.PENDING,
      ScenarioRunStatus.STALLED,
      ScenarioRunStatus.CANCELLED,
      ScenarioRunStatus.QUEUED,
      ScenarioRunStatus.RUNNING,
    ])("returns true for %s", (status) => {
      expect(hasNoResults(status)).toBe(true);
    });
  });

  describe("when the run has reached a terminal state with results", () => {
    it.each([
      ScenarioRunStatus.SUCCESS,
      ScenarioRunStatus.FAILED,
      ScenarioRunStatus.ERROR,
    ])("returns false for %s", (status) => {
      expect(hasNoResults(status)).toBe(false);
    });
  });

  describe("when status is undefined", () => {
    it("returns true", () => {
      expect(hasNoResults(undefined)).toBe(true);
    });
  });
});
