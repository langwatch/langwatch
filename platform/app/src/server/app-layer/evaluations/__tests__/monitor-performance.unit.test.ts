/**
 * @see specs/evaluations/category-evaluator-performance.feature
 *
 * How a period of results is read into the one number, or the one
 * distribution, the online evaluations list shows.
 */

import { describe, expect, it } from "vitest";
import { summarizeMonitorPerformance } from "../monitor-performance.service";
import type {
  MonitorPerformanceBucket,
  MonitorPerformancePeriod,
} from "../repositories/monitor-performance.repository";

const evaluatorId = "monitor-1";

const bucket = (
  overrides: Partial<MonitorPerformanceBucket> & {
    period: MonitorPerformancePeriod;
    day: string;
  },
): MonitorPerformanceBucket => ({
  evaluatorId,
  scoreSum: 0,
  scoreCount: 0,
  passSum: 0,
  passCount: 0,
  labelCounts: {},
  ...overrides,
});

const summarize = (buckets: MonitorPerformanceBucket[], isGuardrail = false) =>
  summarizeMonitorPerformance({
    monitors: [{ id: evaluatorId, isGuardrail }],
    buckets,
  })[0]!;

describe("summarizeMonitorPerformance", () => {
  describe("given a monitor whose results carry only a label", () => {
    /** @scenario "An evaluator that only writes labels is summarized by label share" */
    it("reports a label distribution ordered by how often each label occurred", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-01",
          labelCounts: { negative: 1, positive: 3 },
        }),
        bucket({
          period: "current",
          day: "2026-09-02",
          labelCounts: { neutral: 2, positive: 4 },
        }),
      ]);

      expect(result.metric).toBe("label");
      if (result.metric !== "label") throw new Error("expected a label metric");
      expect(result.labels).toEqual([
        { label: "positive", count: 7, share: 0.7 },
        { label: "neutral", count: 2, share: 0.2 },
        { label: "negative", count: 1, share: 0.1 },
      ]);
      expect(result.current).toBe(0.7);
    });

    /** @scenario "The leading label's movement is measured against the same label" */
    it("compares the leading label against its own previous share", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-02",
          labelCounts: { positive: 6, negative: 4 },
        }),
        bucket({
          period: "previous",
          day: "2026-08-26",
          labelCounts: { positive: 2, negative: 8 },
        }),
      ]);

      if (result.metric !== "label") throw new Error("expected a label metric");
      expect(result.current).toBe(0.6);
      expect(result.previous).toBe(0.2);
    });

    /** @scenario "A leading label absent from the previous period counts as no share" */
    it("reads an absent label as a share of zero when the period had results", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-02",
          labelCounts: { escalated: 5 },
        }),
        bucket({
          period: "previous",
          day: "2026-08-26",
          labelCounts: { resolved: 5 },
        }),
      ]);

      if (result.metric !== "label") throw new Error("expected a label metric");
      expect(result.current).toBe(1);
      expect(result.previous).toBe(0);
    });

    it("supports no comparison when the previous period had no results", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-02",
          labelCounts: { escalated: 5 },
        }),
      ]);

      expect(result.previous).toBeNull();
    });

    /** @scenario "Only the most common labels are kept, the rest are grouped" */
    it("keeps the most common labels and groups the rest", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-02",
          labelCounts: {
            a: 30,
            b: 25,
            c: 20,
            d: 10,
            e: 8,
            f: 4,
            g: 2,
            h: 1,
          },
        }),
      ]);

      if (result.metric !== "label") throw new Error("expected a label metric");
      expect(result.labels.map((entry) => entry.label)).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
        "Other",
      ]);
      expect(result.labels.at(-1)).toEqual({
        label: "Other",
        count: 7,
        share: 0.07,
      });
      const total = result.labels.reduce((sum, e) => sum + e.share, 0);
      expect(total).toBeCloseTo(1, 10);
    });
  });

  describe("given a monitor whose results carry a score", () => {
    /** @scenario "A scoring evaluator is still summarized by score" */
    it("reports the score even when the results also carry labels", () => {
      const result = summarize([
        bucket({
          period: "current",
          day: "2026-09-02",
          scoreSum: 1.5,
          scoreCount: 2,
          labelCounts: { positive: 2 },
        }),
      ]);

      expect(result.metric).toBe("score");
      expect(result.current).toBe(0.75);
    });
  });

  describe("given a guardrail monitor", () => {
    /** @scenario "A guardrail is still summarized by pass rate" */
    it("reports the pass rate even when the results carry labels", () => {
      const result = summarize(
        [
          bucket({
            period: "current",
            day: "2026-09-02",
            passSum: 3,
            passCount: 4,
            labelCounts: { blocked: 1 },
          }),
        ],
        true,
      );

      expect(result.metric).toBe("pass_rate");
      expect(result.current).toBe(0.75);
    });
  });

  describe("given a monitor with no results in either period", () => {
    /** @scenario "A monitor with no results at all reports nothing to show" */
    it("reports no value", () => {
      const result = summarize([]);

      expect(result).toEqual({
        monitorId: evaluatorId,
        metric: "score",
        points: [],
        current: null,
        previous: null,
      });
    });
  });
});
