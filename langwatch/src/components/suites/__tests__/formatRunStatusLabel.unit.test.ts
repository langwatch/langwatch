/**
 * Unit tests for formatRunStatusLabel.
 *
 * @see specs/features/suites/suite-list-view-status.feature
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { formatRunStatusLabel } from "../format-run-status-label";

describe("formatRunStatusLabel()", () => {
  describe("when status is success", () => {
    describe("when the run has met and unmet criteria", () => {
      it("returns 'passed' with criteria count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: {
            metCriteria: ["c1", "c2", "c3", "c4", "c5"],
            unmetCriteria: [],
          },
        });
        expect(result).toBe("Passed (5/5)");
      });
    });

    describe("when the run has no evaluation results", () => {
      it("returns 'passed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: undefined,
        });
        expect(result).toBe("Passed");
      });
    });

    describe("when the run has null results", () => {
      it("returns 'Passed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: null,
        });
        expect(result).toBe("Passed");
      });
    });

    describe("when the run has zero criteria", () => {
      it("returns 'passed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: {
            metCriteria: [],
            unmetCriteria: [],
          },
        });
        expect(result).toBe("Passed");
      });
    });
  });

  describe("when status is failed", () => {
    describe("when the run has met and unmet criteria", () => {
      it("returns 'failed' with criteria count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.FAILED,
          results: {
            metCriteria: ["c1", "c2", "c3"],
            unmetCriteria: ["c4", "c5"],
          },
        });
        expect(result).toBe("Failed (3/5)");
      });
    });

    describe("when the run has zero criteria", () => {
      it("returns 'failed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.FAILED,
          results: {
            metCriteria: [],
            unmetCriteria: [],
          },
        });
        expect(result).toBe("Failed");
      });
    });

    describe("when the run has no evaluation results", () => {
      it("returns 'Failed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.FAILED,
          results: undefined,
        });
        expect(result).toBe("Failed");
      });
    });
  });

  describe("when status is error", () => {
    it("returns 'failed' with criteria count if available", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.ERROR,
        results: {
          metCriteria: ["c1"],
          unmetCriteria: ["c2", "c3"],
        },
      });
      expect(result).toBe("Failed (1/3)");
    });
  });

  describe("when status is in_progress", () => {
    it("returns 'running' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: undefined,
      });
      expect(result).toBe("Running");
    });
  });

  describe("when status is pending", () => {
    it("returns 'pending' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.PENDING,
        results: undefined,
      });
      expect(result).toBe("Pending");
    });
  });

  describe("when status is stalled", () => {
    it("returns 'stalled' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.STALLED,
        results: undefined,
      });
      expect(result).toBe("Stalled");
    });
  });

  describe("when status is cancelled", () => {
    it("returns 'cancelled' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.CANCELLED,
        results: undefined,
      });
      expect(result).toBe("Cancelled");
    });
  });
});
