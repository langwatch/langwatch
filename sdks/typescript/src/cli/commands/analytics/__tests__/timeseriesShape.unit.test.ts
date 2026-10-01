import { describe, expect, it } from "vitest";

import { humanMetric, toTimeseriesShape, unitFor } from "../timeseriesShape";

const day = (iso: string) => Date.parse(iso);

describe("toTimeseriesShape", () => {
  describe("given an analytics result with several buckets", () => {
    it("names the series after the metric, not the metric path", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), "performance.total_cost": 0.11 },
          { date: day("2026-07-16"), "performance.total_cost": 0.28 },
        ],
        previousPeriod: [],
        metric: "performance.total_cost",
      });

      expect(shape?.series[0]?.name).toBe("Total cost");
      expect(shape?.title).toBe("Total cost");
    });

    it("puts each bucket on the axis as its own day", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), cost: 0.11 },
          { date: day("2026-07-16"), cost: 0.28 },
        ],
        previousPeriod: [],
        metric: "performance.total_cost",
      });

      expect(shape?.series[0]?.points).toEqual([
        { t: "2026-07-15", v: 0.11 },
        { t: "2026-07-16", v: 0.28 },
      ]);
    });

    it("sums the groups in a bucket, so a grouped query still plots one line", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), "gpt-5": 0.1, "gpt-5-mini": 0.02 },
          { date: day("2026-07-16"), "gpt-5": 0.2, "gpt-5-mini": 0.05 },
        ],
        previousPeriod: [],
        metric: "performance.total_cost",
      });

      expect(shape?.series[0]?.points.map((p) => p.v)).toEqual([0.12000000000000001, 0.25]);
    });

    it("sums the measures nested under a group-by dimension", () => {
      const key = "0/metadata.trace_id/cardinality";
      const shape = toTimeseriesShape({
        currentPeriod: [
          {
            date: day("2026-07-15"),
            "metadata.model": { "gpt-5": { [key]: 4 }, "gpt-5-mini": { [key]: 3 } },
          },
          {
            date: day("2026-07-16"),
            "metadata.model": { "gpt-5-mini": { [key]: 2 } },
          },
        ],
        previousPeriod: [],
        metric: "metadata.trace_id",
      });

      expect(shape?.series[0]?.points.map((p) => p.v)).toEqual([7, 2]);
    });
  });

  describe("given a bucket with no date", () => {
    it("drops it, because a point with no x position can only be invented", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), cost: 0.11 },
          { cost: 0.99 },
          { date: day("2026-07-16"), cost: 0.28 },
        ],
        previousPeriod: [],
        metric: "performance.total_cost",
      });

      expect(shape?.series[0]?.points).toHaveLength(2);
    });
  });

  describe("given only one bucket", () => {
    it("returns nothing — one reading is not a trend", () => {
      expect(
        toTimeseriesShape({
          currentPeriod: [{ date: day("2026-07-15"), cost: 0.11 }],
          previousPeriod: [],
          metric: "performance.total_cost",
        }),
      ).toBeNull();
    });
  });

  describe("given a previous period to compare against", () => {
    it("carries the two totals as the card's headline", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), cost: 0.1 },
          { date: day("2026-07-16"), cost: 0.3 },
        ],
        previousPeriod: [
          { date: day("2026-07-08"), cost: 0.05 },
          { date: day("2026-07-09"), cost: 0.05 },
        ],
        metric: "performance.total_cost",
      });

      expect(shape?.comparison).toEqual({
        label: "This period",
        value: 0.4,
        baselineLabel: "Previous period",
        baseline: 0.1,
      });
    });
  });

  describe("given no previous period", () => {
    it("omits the comparison rather than compare against zero", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-07-15"), cost: 0.1 },
          { date: day("2026-07-16"), cost: 0.3 },
        ],
        previousPeriod: [],
        metric: "performance.total_cost",
      });

      expect(shape?.comparison).toBeUndefined();
    });
  });
});

describe("given a grouped average over several days", () => {
  const byModel = (mini: number, terra: number) => ({
    "metadata.model": {
      "gpt-5-mini": { "0/performance.completion_time/avg": mini },
      "gpt-5.6-terra": { "0/performance.completion_time/avg": terra },
    },
  });
  const shape = () =>
    toTimeseriesShape({
      currentPeriod: [
        { date: day("2026-09-28"), ...byModel(1, 3) },
        { date: day("2026-09-29"), ...byModel(2, 4) },
      ],
      previousPeriod: [
        { date: day("2026-09-26"), ...byModel(1, 1) },
        { date: day("2026-09-27"), ...byModel(1, 1) },
      ],
      metric: "performance.completion_time",
      aggregation: "avg",
    });

  describe("when it is shaped for the timeseries card", () => {
    /** @scenario A grouped average is never summed into one figure */
    it("draws one line per model instead of summing the averages", () => {
      expect(shape()?.series).toEqual([
        {
          name: "gpt-5-mini",
          points: [
            { t: "2026-09-28", v: 1 },
            { t: "2026-09-29", v: 2 },
          ],
        },
        {
          name: "gpt-5.6-terra",
          points: [
            { t: "2026-09-28", v: 3 },
            { t: "2026-09-29", v: 4 },
          ],
        },
      ]);
    });

    /** @scenario A grouped average is never summed into one figure */
    it("adds no period-over-period total", () => {
      expect(shape()?.comparison).toBeUndefined();
    });
  });
});

describe("given a distinct count over several days", () => {
  const daily = (metric: string, values: [number, number]) =>
    values.map((v, i) => ({
      date: day(`2026-09-2${8 + i}`),
      [`0/${metric}/cardinality`]: v,
    }));

  describe("when it counts users", () => {
    /** @scenario A distinct count is added up only where each id falls once */
    it("draws the daily counts with no period total, since a user can return", () => {
      const shape = toTimeseriesShape({
        currentPeriod: daily("metadata.user_id", [3, 4]),
        previousPeriod: daily("metadata.user_id", [2, 2]),
        metric: "metadata.user_id",
        aggregation: "cardinality",
      });

      expect(shape?.series[0]?.points.map((p) => p.v)).toEqual([3, 4]);
      expect(shape?.comparison).toBeUndefined();
    });
  });

  describe("when it counts traces", () => {
    /** @scenario A distinct count is added up only where each id falls once */
    it("totals the period, since each trace falls on one day", () => {
      const shape = toTimeseriesShape({
        currentPeriod: daily("metadata.trace_id", [3, 4]),
        previousPeriod: daily("metadata.trace_id", [2, 2]),
        metric: "metadata.trace_id",
        aggregation: "cardinality",
      });

      expect(shape?.comparison).toMatchObject({ value: 7, baseline: 4 });
    });

    /** @scenario A distinct count is added up only where each id falls once */
    it("draws one line per model when split by model, since a trace can carry two", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [3, 4].map((v, i) => ({
          date: day(`2026-09-2${8 + i}`),
          "metadata.model": {
            "gpt-5-mini": { "0/metadata.trace_id/cardinality": v },
            "gpt-5.6-terra": { "0/metadata.trace_id/cardinality": 1 },
          },
        })),
        previousPeriod: [],
        metric: "metadata.trace_id",
        aggregation: "cardinality",
      });

      expect(shape?.series.map((s) => s.name)).toEqual([
        "gpt-5-mini",
        "gpt-5.6-terra",
      ]);
      expect(shape?.comparison).toBeUndefined();
    });
  });
});

describe("given a flat average over several days", () => {
  describe("when it is shaped for the timeseries card", () => {
    it("draws the daily averages as one line named after the metric", () => {
      const shape = toTimeseriesShape({
        currentPeriod: [
          { date: day("2026-09-28"), "0/performance.completion_time/avg": 5 },
          { date: day("2026-09-29"), "0/performance.completion_time/avg": 7 },
        ],
        previousPeriod: [],
        metric: "performance.completion_time",
        aggregation: "avg",
      });

      expect(shape?.series).toEqual([
        {
          name: "Completion time",
          points: [
            { t: "2026-09-28", v: 5 },
            { t: "2026-09-29", v: 7 },
          ],
        },
      ]);
    });
  });
});

describe("unitFor", () => {
  describe("given a metric path", () => {
    it("reads the unit off the metric, never off the values", () => {
      // The values cannot be trusted for this: a day of costs between 0 and 1
      // is not a percentage, however much it looks like one.
      expect(unitFor("performance.total_cost")).toBe("usd");
      expect(unitFor("performance.total_tokens")).toBe("tokens");
      expect(unitFor("performance.completion_time")).toBe("ms");
      expect(unitFor("evaluations.evaluation_pass_rate")).toBe("percent");
      expect(unitFor("metadata.trace_id")).toBe("count");
    });
  });
});

describe("humanMetric", () => {
  it("turns a metric path into something a person would write", () => {
    expect(humanMetric("performance.total_cost")).toBe("Total cost");
    expect(humanMetric("metadata.user_id")).toBe("User id");
  });
});
