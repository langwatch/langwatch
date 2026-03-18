/**
 * Unit tests for scenario run cancellation eligibility logic.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature (@unit scenarios)
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "../scenario-event.enums";
import { isCancellableStatus } from "../scenario-event.enums";

describe("isCancellableStatus()", () => {
  describe("when status is PENDING", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.PENDING)).toBe(true);
    });
  });

  describe("when status is IN_PROGRESS", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.IN_PROGRESS)).toBe(true);
    });
  });

  describe("when status is STALLED", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.STALLED)).toBe(true);
    });
  });

  describe("when status is SUCCESS", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.SUCCESS)).toBe(false);
    });
  });

  describe("when status is FAILED", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.FAILED)).toBe(false);
    });
  });

  describe("when status is ERROR", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.ERROR)).toBe(false);
    });
  });

  describe("when status is CANCELLED", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.CANCELLED)).toBe(false);
    });
  });
});
