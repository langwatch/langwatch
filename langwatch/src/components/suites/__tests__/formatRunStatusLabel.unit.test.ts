/**
 * Unit tests for formatRunStatusLabel.
 *
 * @see specs/features/suites/suite-list-view-status.feature
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { formatRunStatusLabel, formatSummaryStatusLabel } from "../format-run-status-label";

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
        expect(result).toBe("passed (5/5)");
      });
    });

    describe("when the run has no evaluation results", () => {
      it("returns 'passed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: undefined,
        });
        expect(result).toBe("passed");
      });
    });

    describe("when the run has null results", () => {
      it("returns 'passed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.SUCCESS,
          results: null,
        });
        expect(result).toBe("passed");
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
        expect(result).toBe("passed");
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
        expect(result).toBe("failed (3/5)");
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
        expect(result).toBe("failed");
      });
    });

    describe("when the run has no evaluation results", () => {
      it("returns 'failed' without count", () => {
        const result = formatRunStatusLabel({
          status: ScenarioRunStatus.FAILED,
          results: undefined,
        });
        expect(result).toBe("failed");
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
      expect(result).toBe("failed (1/3)");
    });
  });

  describe("when status is in_progress", () => {
    it("returns 'running' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: undefined,
      });
      expect(result).toBe("running");
    });
  });

  describe("when status is pending", () => {
    it("returns 'pending' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.PENDING,
        results: undefined,
      });
      expect(result).toBe("pending");
    });
  });

  describe("when status is stalled", () => {
    it("returns 'stalled' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.STALLED,
        results: undefined,
      });
      expect(result).toBe("stalled");
    });
  });

  describe("when status is cancelled", () => {
    it("returns 'cancelled' without criteria count", () => {
      const result = formatRunStatusLabel({
        status: ScenarioRunStatus.CANCELLED,
        results: undefined,
      });
      expect(result).toBe("cancelled");
    });
  });
});

describe("formatSummaryStatusLabel()", () => {
  const makeSummary = (overrides: Partial<Parameters<typeof formatSummaryStatusLabel>[0]> = {}) => ({
    passRate: 0,
    passedCount: 0,
    failedCount: 0,
    stalledCount: 0,
    cancelledCount: 0,
    totalCount: 0,
    inProgressCount: 0,
    queuedCount: 0,
    ...overrides,
  });

  describe("when all scenarios passed", () => {
    it("returns 'passed' with scenario count", () => {
      const result = formatSummaryStatusLabel(makeSummary({
        passedCount: 5,
        totalCount: 5,
      }));
      expect(result).toBe("passed (5/5)");
    });
  });

  describe("when some scenarios failed", () => {
    it("returns 'failed' with passed/finished count", () => {
      const result = formatSummaryStatusLabel(makeSummary({
        passedCount: 3,
        failedCount: 2,
        totalCount: 5,
      }));
      expect(result).toBe("failed (3/5)");
    });
  });

  describe("when all scenarios are in progress", () => {
    it("returns 'running'", () => {
      const result = formatSummaryStatusLabel(makeSummary({
        inProgressCount: 3,
        totalCount: 3,
      }));
      expect(result).toBe("running");
    });
  });

  describe("when no scenarios exist", () => {
    it("returns 'pending'", () => {
      const result = formatSummaryStatusLabel(makeSummary());
      expect(result).toBe("pending");
    });
  });

  describe("when some scenarios are stalled", () => {
    it("includes stalled in finished count", () => {
      const result = formatSummaryStatusLabel(makeSummary({
        passedCount: 2,
        failedCount: 1,
        stalledCount: 1,
        totalCount: 4,
      }));
      expect(result).toBe("failed (2/4)");
    });
  });

  describe("when some are finished and some still running", () => {
    it("shows only finished scenarios in count", () => {
      const result = formatSummaryStatusLabel(makeSummary({
        passedCount: 3,
        failedCount: 0,
        inProgressCount: 2,
        totalCount: 5,
      }));
      expect(result).toBe("passed (3/3)");
    });
  });
});
