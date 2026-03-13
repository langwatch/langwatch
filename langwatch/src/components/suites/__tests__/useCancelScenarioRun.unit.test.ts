/**
 * @vitest-environment jsdom
 *
 * Unit tests for isCancellableStatus.
 *
 * Verifies that only in-flight statuses (PENDING, IN_PROGRESS, STALLED)
 * are eligible for cancellation, matching the server-side logic.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature - "Only cancellable statuses are eligible"
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { isCancellableStatus } from "../useCancelScenarioRun";

describe("isCancellableStatus()", () => {
  describe("given a PENDING status", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.PENDING)).toBe(true);
    });
  });

  describe("given an IN_PROGRESS status", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.IN_PROGRESS)).toBe(true);
    });
  });

  describe("given a STALLED status", () => {
    it("returns true", () => {
      expect(isCancellableStatus(ScenarioRunStatus.STALLED)).toBe(true);
    });
  });

  describe("given a SUCCESS status", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.SUCCESS)).toBe(false);
    });
  });

  describe("given a FAILED status", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.FAILED)).toBe(false);
    });
  });

  describe("given an ERROR status", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.ERROR)).toBe(false);
    });
  });

  describe("given a CANCELLED status", () => {
    it("returns false", () => {
      expect(isCancellableStatus(ScenarioRunStatus.CANCELLED)).toBe(false);
    });
  });
});
