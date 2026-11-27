/**
 * @vitest-environment node
 * @see modules/evaluation/specs/category-evaluator-performance.feature
 *
 * How a period of results reads as the one number, or the one distribution,
 * the online evaluations list shows.
 */
import type { OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import {
  MonitorPerformanceRepository,
  type EvaluatorOutcomeRow,
  type EvaluatorTypeUsageRow,
  type MonitorPerformanceBucket,
} from "../../../../repositories/monitor-performance.repository.ts";
import { MonitorPerformanceService } from "../monitor-performance.service.ts";

const MONITOR_ID = "monitor-1";

class InMemoryMonitorPerformanceRepository extends MonitorPerformanceRepository {
  constructor(private readonly buckets: MonitorPerformanceBucket[]) {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return this.buckets;
  }

  async findOutcomeRows(): Promise<EvaluatorOutcomeRow[]> {
    return [];
  }

  async findTypeUsageRows(): Promise<EvaluatorTypeUsageRow[]> {
    return [];
  }
}

const bucket = (
  overrides: Partial<MonitorPerformanceBucket> & Pick<MonitorPerformanceBucket, "period" | "day">,
): MonitorPerformanceBucket => ({
  evaluatorId: MONITOR_ID,
  scoreSum: 0,
  scoreCount: 0,
  passSum: 0,
  passCount: 0,
  labelCounts: {},
  ...overrides,
});

async function summarize({
  buckets,
  isGuardrail = false,
}: {
  buckets: MonitorPerformanceBucket[];
  isGuardrail?: boolean;
}): Promise<OnlineEvaluationPerformance> {
  const service = MonitorPerformanceService.create({
    repository: new InMemoryMonitorPerformanceRepository(buckets),
  });
  const [performance] = await service.getMonitorPerformance({
    tenantId: "project-1",
    monitors: [{ id: MONITOR_ID, isGuardrail }],
    previousStartMs: 0,
    currentStartMs: 1,
    endMs: 2,
    timeZone: "UTC",
  });
  return performance!;
}

function labelsOf(performance: OnlineEvaluationPerformance) {
  if (performance.metric !== "label") throw new Error(`expected labels, got ${performance.metric}`);
  return performance;
}

describe("MonitorPerformanceService", () => {
  describe("given a monitor whose results carry only a label", () => {
    /** @scenario "An evaluator that only writes labels is summarized by label share" */
    it("reports a label distribution ordered by how often each label occurred", async () => {
      const performance = labelsOf(
        await summarize({
          buckets: [
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
          ],
        }),
      );

      expect(performance.labels).toEqual([
        { label: "positive", count: 7, share: 0.7, grouped: false },
        { label: "neutral", count: 2, share: 0.2, grouped: false },
        { label: "negative", count: 1, share: 0.1, grouped: false },
      ]);
      expect(performance.current).toBe(0.7);
      expect(performance.points).toEqual([]);
    });

    /** @scenario "The leading label's movement is measured against the same label" */
    it("compares the leading label against its own previous share", async () => {
      const performance = labelsOf(
        await summarize({
          buckets: [
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
          ],
        }),
      );

      expect(performance.current).toBe(0.6);
      expect(performance.previous).toBe(0.2);
    });

    /** @scenario "A leading label absent from the previous period counts as no share" */
    it("reads an absent label as a share of zero when the period had results", async () => {
      const performance = labelsOf(
        await summarize({
          buckets: [
            bucket({ period: "current", day: "2026-09-02", labelCounts: { escalated: 5 } }),
            bucket({ period: "previous", day: "2026-08-26", labelCounts: { resolved: 5 } }),
          ],
        }),
      );

      expect(performance.current).toBe(1);
      expect(performance.previous).toBe(0);
    });

    /** @scenario "A previous period with no results supports no comparison" */
    it("supports no comparison when the previous period had no results", async () => {
      const performance = labelsOf(
        await summarize({
          buckets: [
            bucket({ period: "current", day: "2026-09-02", labelCounts: { escalated: 5 } }),
          ],
        }),
      );

      expect(performance.previous).toBeNull();
    });

    /** @scenario "Only the most common labels are kept, the rest are grouped" */
    it("keeps the most common labels and groups the rest apart from a real Other label", async () => {
      const performance = labelsOf(
        await summarize({
          buckets: [
            bucket({
              period: "current",
              day: "2026-09-02",
              labelCounts: { a: 30, Other: 25, c: 20, d: 10, e: 8, f: 4, g: 2, h: 1 },
            }),
          ],
        }),
      );

      expect(performance.labels.map(({ label, grouped }) => [label, grouped])).toEqual([
        ["a", false],
        ["Other", false],
        ["c", false],
        ["d", false],
        ["e", false],
        ["Other", true],
      ]);
      expect(performance.labels.at(-1)).toEqual({
        label: "Other",
        count: 7,
        share: 0.07,
        grouped: true,
      });
      const total = performance.labels.reduce((sum, entry) => sum + entry.share, 0);
      expect(total).toBeCloseTo(1, 10);
    });
  });

  describe("given a monitor whose results carry a score", () => {
    /** @scenario "A scoring evaluator is still summarized by score" */
    it("reports the score even when the results also carry labels", async () => {
      const performance = await summarize({
        buckets: [
          bucket({
            period: "current",
            day: "2026-09-02",
            scoreSum: 1.5,
            scoreCount: 2,
            labelCounts: { positive: 2 },
          }),
        ],
      });

      expect(performance.metric).toBe("score");
      expect(performance.current).toBe(0.75);
    });
  });

  describe("given a guardrail monitor", () => {
    /** @scenario "A guardrail is still summarized by pass rate" */
    it("reports the pass rate even when the results carry labels", async () => {
      const performance = await summarize({
        isGuardrail: true,
        buckets: [
          bucket({
            period: "current",
            day: "2026-09-02",
            passSum: 3,
            passCount: 4,
            labelCounts: { blocked: 1 },
          }),
        ],
      });

      expect(performance.metric).toBe("pass_rate");
      expect(performance.current).toBe(0.75);
    });
  });

  describe("given a monitor with no results in either period", () => {
    /** @scenario "A monitor with no results at all reports nothing to show" */
    it("reports no value", async () => {
      await expect(summarize({ buckets: [] })).resolves.toEqual({
        monitorId: MONITOR_ID,
        metric: "score",
        points: [],
        current: null,
        previous: null,
      });
    });
  });
});
