/**
 * The status label of a scenario run: the status word, and the criteria count once there is one.
 * @see specs/features/suites/suite-list-view-status.feature
 */
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { formatRunStatusLabel } from "../format-run-status-label.ts";

const criteria = ({ met, unmet }: { met: number; unmet: number }) => ({
  metCriteria: Array.from({ length: met }, (_, i) => `met ${i}`),
  unmetCriteria: Array.from({ length: unmet }, (_, i) => `unmet ${i}`),
});

describe("formatRunStatusLabel()", () => {
  describe("given a successful run with five met criteria", () => {
    it("reads Passed with the count of met over all criteria", () => {
      const label = formatRunStatusLabel({
        status: ScenarioRunStatus.SUCCESS,
        results: criteria({ met: 5, unmet: 0 }),
      });

      expect(label).toBe("Passed (5/5)");
    });
  });

  describe("given a failed run with three met and two unmet criteria", () => {
    it("reads Failed with the count of met over all criteria", () => {
      const label = formatRunStatusLabel({
        status: ScenarioRunStatus.FAILED,
        results: criteria({ met: 3, unmet: 2 }),
      });

      expect(label).toBe("Failed (3/5)");
    });
  });

  describe("given a successful run with no evaluation results", () => {
    it("reads Passed with no count", () => {
      const label = formatRunStatusLabel({ status: ScenarioRunStatus.SUCCESS, results: null });

      expect(label).toBe("Passed");
    });
  });

  describe("given a failed run with zero criteria", () => {
    it("reads Failed with no count", () => {
      const label = formatRunStatusLabel({
        status: ScenarioRunStatus.FAILED,
        results: criteria({ met: 0, unmet: 0 }),
      });

      expect(label).toBe("Failed");
    });
  });

  describe("given a run that has not finished", () => {
    it("reads Running for an in-progress run, even when criteria are listed", () => {
      const label = formatRunStatusLabel({
        status: ScenarioRunStatus.IN_PROGRESS,
        results: criteria({ met: 1, unmet: 1 }),
      });

      expect(label).toBe("Running");
    });

    it("reads Pending for a pending run", () => {
      expect(formatRunStatusLabel({ status: ScenarioRunStatus.PENDING })).toBe("Pending");
    });
  });
});
