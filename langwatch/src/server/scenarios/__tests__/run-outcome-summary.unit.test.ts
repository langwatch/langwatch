/**
 * Unit tests for the canonical run-outcome counting.
 *
 * These pin the arithmetic that every surface quoting a pass rate is expected
 * to call rather than reimplement. The run history panel's summary is checked
 * against this module in run-history-transforms.unit.test.ts — if that check
 * ever fails, the panel has grown a second copy of the formula.
 *
 * @see specs/suites/pass-rate-single-source.feature
 */
import { describe, expect, it } from "vitest";
import { countRunOutcomes, passRateFrom } from "../run-outcome-summary";
import { ScenarioRunStatus } from "../scenario-event.enums";

/** Pass rate for a list of statuses, the two calls the callers make. */
function passRateOf(statuses: ScenarioRunStatus[]): number | null {
  return passRateFrom({ counts: countRunOutcomes({ statuses }) });
}

function repeat(status: ScenarioRunStatus, times: number): ScenarioRunStatus[] {
  return Array.from({ length: times }, () => status);
}

const MIXED_OUTCOMES = [
  ...repeat(ScenarioRunStatus.SUCCESS, 3),
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.STALLED,
  ScenarioRunStatus.CANCELLED,
];

describe("passRateFrom()", () => {
  describe("given a mix of settled outcomes", () => {
    /** @scenario Pass rate is passed over settled */
    it("divides passed by every run that reached a terminal state", () => {
      expect(passRateOf(MIXED_OUTCOMES)).toBe(50);
    });
  });

  describe("when some runs have not finished", () => {
    /** @scenario Runs still going are outside the pass rate */
    it("excludes in-progress runs from the denominator", () => {
      expect(
        passRateOf([
          ...repeat(ScenarioRunStatus.SUCCESS, 2),
          ...repeat(ScenarioRunStatus.IN_PROGRESS, 2),
        ]),
      ).toBe(100);
    });

    /** @scenario Queued runs are outside the pass rate */
    it("excludes queued runs from the denominator", () => {
      expect(
        passRateOf([
          ...repeat(ScenarioRunStatus.SUCCESS, 2),
          ...repeat(ScenarioRunStatus.QUEUED, 2),
        ]),
      ).toBe(100);
    });
  });

  describe("when runs ended without passing", () => {
    /** @scenario Stalled runs count against the pass rate */
    it("counts a stalled run in the denominator", () => {
      expect(
        passRateOf([
          ...repeat(ScenarioRunStatus.SUCCESS, 2),
          ScenarioRunStatus.STALLED,
        ]),
      ).toBeCloseTo(66.67, 1);
    });

    /** @scenario Cancelled runs count against the pass rate */
    it("counts a cancelled run in the denominator", () => {
      expect(
        passRateOf([
          ...repeat(ScenarioRunStatus.SUCCESS, 2),
          ScenarioRunStatus.CANCELLED,
        ]),
      ).toBeCloseTo(66.67, 1);
    });
  });

  describe("when nothing has settled yet", () => {
    /** @scenario A group with nothing settled has no pass rate rather than zero */
    it("reports no pass rate rather than zero", () => {
      expect(passRateOf(repeat(ScenarioRunStatus.IN_PROGRESS, 3))).toBeNull();
    });

    /** @scenario A group with no runs at all has a pass rate of zero */
    it("reports zero for an empty group", () => {
      expect(passRateOf([])).toBe(0);
    });
  });
});

describe("countRunOutcomes()", () => {
  describe("given a mix of settled outcomes", () => {
    /** @scenario Completed counts only the runs that reached a verdict */
    it("separates completed from settled", () => {
      const counts = countRunOutcomes({ statuses: MIXED_OUTCOMES });

      expect(counts.completedCount).toBe(4);
      expect(counts.settledCount).toBe(6);
      expect(counts.totalCount).toBe(6);
    });
  });

  describe("given every status the enum can produce", () => {
    const bucketOf: Array<
      [ScenarioRunStatus, keyof ReturnType<typeof countRunOutcomes>]
    > = [
      [ScenarioRunStatus.SUCCESS, "passedCount"],
      [ScenarioRunStatus.FAILED, "failedCount"],
      [ScenarioRunStatus.ERROR, "failedCount"],
      [ScenarioRunStatus.STALLED, "stalledCount"],
      [ScenarioRunStatus.CANCELLED, "cancelledCount"],
      [ScenarioRunStatus.IN_PROGRESS, "inProgressCount"],
      [ScenarioRunStatus.PENDING, "inProgressCount"],
      [ScenarioRunStatus.RUNNING, "inProgressCount"],
      [ScenarioRunStatus.QUEUED, "queuedCount"],
    ];

    /** @scenario Every run status lands in exactly one bucket */
    it.each(bucketOf)("counts %s as %s", (status, bucket) => {
      const counts = countRunOutcomes({ statuses: [status] });

      expect(counts[bucket]).toBe(1);
      expect(counts.totalCount).toBe(1);
    });

    it("covers every status the enum declares", () => {
      const covered = new Set(bucketOf.map(([status]) => status));

      expect(covered).toEqual(new Set(Object.values(ScenarioRunStatus)));
    });
  });
});
