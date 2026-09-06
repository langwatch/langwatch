import { describe, expect, it } from "vitest";
import {
  humanMetric,
  toTimeseriesShape,
  unitFor,
} from "../timeseriesShape";

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

      expect(shape?.series[0]?.points.map((p) => p.v)).toEqual([
        0.12000000000000001, 0.25,
      ]);
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
