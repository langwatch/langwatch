/**
 * Unit tests for the shared timeseries row parser
 * (`repositories/_timeseries-row-parser.ts`).
 *
 * Pins the bucket-normalisation contract: additive series (counts / sums)
 * default missing buckets to 0 because "no rows" really is zero, while
 * average-type series (avg / min / max / percentiles) stay absent — a
 * defaulted 0 there fabricates a value, e.g. a 0% pass rate on a day the
 * evaluator never ran, which made the Evaluations-page card show 25% while
 * the analytics donut correctly showed 100% for the same evaluator.
 * See specs/analytics/evaluation-pass-rate-consistency.feature.
 */

import { describe, expect, it } from "vitest";
import { buildMetricAlias } from "~/server/analytics/clickhouse/metric-translator";
import type { SeriesInputType } from "~/server/analytics/registry";
import {
  buildSeriesName,
  parseTimeseriesRows,
} from "../repositories/_timeseries-row-parser";

const alias = (series: SeriesInputType, index: number) =>
  buildMetricAlias(index, series.metric, series.aggregation, series.key);

const passRateSeries: SeriesInputType = {
  metric: "evaluations.evaluation_pass_rate",
  aggregation: "avg",
  key: "monitor_123",
};

const runsSeries: SeriesInputType = {
  metric: "evaluations.evaluation_runs",
  aggregation: "cardinality",
  key: "monitor_123",
};

describe("parseTimeseriesRows", () => {
  describe("given an average pass-rate series with processed runs in only one bucket", () => {
    // ClickHouse returns NaN for avgIf over zero matching rows; JSONEachRow
    // serialises it as null, so the cell arrives as null for empty buckets.
    const passRateAlias = alias(passRateSeries, 0);
    const rows = [
      { period: "current", date: "2026-07-13", [passRateAlias]: null },
      { period: "current", date: "2026-07-14", [passRateAlias]: null },
      { period: "current", date: "2026-07-16", [passRateAlias]: 1 },
    ];

    describe("when the rows are parsed", () => {
      const result = parseTimeseriesRows({
        rows,
        series: [passRateSeries],
        timeScale: 1440,
      });
      const seriesName = buildSeriesName(passRateSeries, 0);

      it("keeps the real value in the bucket that has runs", () => {
        expect(result.currentPeriod[2]?.[seriesName]).toBe(1);
      });

      it("carries no value for buckets without processed runs", () => {
        expect(result.currentPeriod[0]).not.toHaveProperty(seriesName);
        expect(result.currentPeriod[1]).not.toHaveProperty(seriesName);
      });

      it("does not fabricate a 0% pass rate for buckets the evaluator never ran in", () => {
        const values = result.currentPeriod.map((bucket) => bucket[seriesName]);
        expect(values).not.toContain(0);
      });
    });
  });

  describe("given a count series and a pass-rate series where one bucket has neither value", () => {
    const passRateAlias = alias(passRateSeries, 0);
    const runsAlias = alias(runsSeries, 1);
    const rows = [
      {
        period: "current",
        date: "2026-07-15",
        [passRateAlias]: null,
        [runsAlias]: null,
      },
      {
        period: "current",
        date: "2026-07-16",
        [passRateAlias]: 1,
        [runsAlias]: "6",
      },
    ];

    describe("when the rows are parsed", () => {
      const result = parseTimeseriesRows({
        rows,
        series: [passRateSeries, runsSeries],
        timeScale: 1440,
      });
      const passRateName = buildSeriesName(passRateSeries, 0);
      const runsName = buildSeriesName(runsSeries, 1);

      it("defaults the count series to 0 in the empty bucket", () => {
        expect(result.currentPeriod[0]?.[runsName]).toBe(0);
      });

      it("keeps the pass-rate series absent in the empty bucket", () => {
        expect(result.currentPeriod[0]).not.toHaveProperty(passRateName);
      });

      it("parses both values in the bucket that has data", () => {
        expect(result.currentPeriod[1]?.[passRateName]).toBe(1);
        expect(result.currentPeriod[1]?.[runsName]).toBe(6);
      });
    });
  });

  describe("given a previous period with no data for an average series", () => {
    const passRateAlias = alias(passRateSeries, 0);
    const rows = [
      { period: "previous", date: "2026-06-16", [passRateAlias]: null },
      { period: "current", date: "2026-07-16", [passRateAlias]: 0.5 },
    ];

    describe("when the rows are parsed", () => {
      const result = parseTimeseriesRows({
        rows,
        series: [passRateSeries],
        timeScale: 1440,
      });
      const seriesName = buildSeriesName(passRateSeries, 0);

      it("keeps the previous-period bucket free of a fabricated 0", () => {
        expect(result.previousPeriod[0]).not.toHaveProperty(seriesName);
      });
    });
  });

  describe("given a grouped result with a count series and an average score series", () => {
    const scoreSeries: SeriesInputType = {
      metric: "evaluations.evaluation_score",
      aggregation: "avg",
      key: "monitor_123",
    };
    const runsAlias = alias(runsSeries, 0);
    const scoreAlias = alias(scoreSeries, 1);
    const rows = [
      {
        period: "current",
        date: "2026-07-16",
        group_key: "passed",
        [runsAlias]: "6",
        [scoreAlias]: null,
      },
      {
        period: "current",
        date: "2026-07-16",
        group_key: "failed",
        [runsAlias]: "2",
        [scoreAlias]: 0.4,
      },
    ];

    describe("when the rows are parsed", () => {
      const result = parseTimeseriesRows({
        rows,
        series: [runsSeries, scoreSeries],
        groupBy: "evaluations.evaluation_passed",
        timeScale: 1440,
      });
      const runsName = buildSeriesName(runsSeries, 0);
      const scoreName = buildSeriesName(scoreSeries, 1);
      const groups = result.currentPeriod[0]?.[
        "evaluations.evaluation_passed"
      ] as Record<string, Record<string, number>>;

      it("preserves the count for both groups", () => {
        expect(groups.passed?.[runsName]).toBe(6);
        expect(groups.failed?.[runsName]).toBe(2);
      });

      it("keeps the average score absent for the group without a value", () => {
        expect(groups.passed).not.toHaveProperty(scoreName);
      });

      it("keeps the real average score for the group that has one", () => {
        expect(groups.failed?.[scoreName]).toBe(0.4);
      });
    });
  });

  describe("given pipeline series re-aggregated per user", () => {
    const sumPerUser: SeriesInputType = {
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: { field: "user_id", aggregation: "sum" },
    };
    const avgPerUser: SeriesInputType = {
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: { field: "user_id", aggregation: "avg" },
    };
    const sumAlias = alias(sumPerUser, 0);
    const avgAlias = alias(avgPerUser, 1);
    const rows = [
      {
        period: "current",
        date: "2026-07-15",
        [sumAlias]: null,
        [avgAlias]: null,
      },
      { period: "current", date: "2026-07-16", [sumAlias]: 10, [avgAlias]: 2 },
    ];

    describe("when the rows are parsed", () => {
      const result = parseTimeseriesRows({
        rows,
        series: [sumPerUser, avgPerUser],
        timeScale: 1440,
      });
      const sumName = buildSeriesName(sumPerUser, 0);
      const avgName = buildSeriesName(avgPerUser, 1);

      it("defaults the summed pipeline to 0 in the empty bucket", () => {
        expect(result.currentPeriod[0]?.[sumName]).toBe(0);
      });

      it("keeps the averaged pipeline absent in the empty bucket", () => {
        expect(result.currentPeriod[0]).not.toHaveProperty(avgName);
      });
    });
  });
});
