import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  hasNoResults,
  shouldShowNoResponse,
} from "../scenario-run-status.utils";

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

describe("shouldShowNoResponse()", () => {
  describe("when a finished run produced no messages and no error", () => {
    /** @scenario A finished run with no messages and no error shows "No response" */
    it.each([
      ScenarioRunStatus.SUCCESS,
      ScenarioRunStatus.FAILED,
      ScenarioRunStatus.ERROR,
    ])("shows the no-response state for %s", (status) => {
      expect(
        shouldShowNoResponse({ status, hasConversation: false, hasError: false }),
      ).toBe(true);
    });
  });

  describe("when the run has a conversation", () => {
    it("does not show the no-response state", () => {
      expect(
        shouldShowNoResponse({
          status: ScenarioRunStatus.SUCCESS,
          hasConversation: true,
          hasError: false,
        }),
      ).toBe(false);
    });
  });

  describe("when the run failed with an infrastructure error", () => {
    /** @scenario A run that errored does not show "No response" */
    it("does not show the no-response state (the error is surfaced instead)", () => {
      expect(
        shouldShowNoResponse({
          status: ScenarioRunStatus.ERROR,
          hasConversation: false,
          hasError: true,
        }),
      ).toBe(false);
    });
  });

  describe("when the run is still in flight", () => {
    /** @scenario An in-flight run does not show "No response" */
    it.each([
      ScenarioRunStatus.IN_PROGRESS,
      ScenarioRunStatus.PENDING,
      ScenarioRunStatus.QUEUED,
      ScenarioRunStatus.RUNNING,
      ScenarioRunStatus.STALLED,
    ])("does not show the no-response state for %s", (status) => {
      expect(
        shouldShowNoResponse({ status, hasConversation: false, hasError: false }),
      ).toBe(false);
    });
  });
});
