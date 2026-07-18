import { describe, expect, it } from "vitest";
import type { AggregationSpec, WidgetSpec } from "../model";
import { aggPolarity, deltaTrend, runStubQuery, type StubWindow } from "../stubData";

const costAvg: AggregationSpec = { op: "avg", column: "cost" };
const durationP95: AggregationSpec = { op: "p95", column: "durationMs" };
const throughputAvg: AggregationSpec = { op: "avg", column: "tokensPerSecond" };
const countOnly: AggregationSpec = { op: "count" };
const cardinalityOnCost: AggregationSpec = { op: "cardinality", column: "cost" };

describe("aggPolarity", () => {
  describe("given a metric where a higher value is worse", () => {
    it("returns -1 for cost and latency columns", () => {
      expect(aggPolarity(costAvg)).toBe(-1);
      expect(aggPolarity(durationP95)).toBe(-1);
    });
  });

  describe("given a metric where a higher value is better", () => {
    it("returns 1 for a throughput column", () => {
      expect(aggPolarity(throughputAvg)).toBe(1);
    });
  });

  describe("given an aggregation with no metric column", () => {
    it("defaults to 1 for count and cardinality", () => {
      expect(aggPolarity(countOnly)).toBe(1);
      expect(aggPolarity(cardinalityOnCost)).toBe(1);
    });
  });
});

describe("deltaTrend", () => {
  describe("given a flat delta", () => {
    it("is neither good nor bad regardless of polarity", () => {
      expect(deltaTrend(0, costAvg)).toEqual({ direction: "flat", isGood: null });
      expect(deltaTrend(0, throughputAvg)).toEqual({ direction: "flat", isGood: null });
    });
  });

  describe("given a metric where up is bad (cost)", () => {
    it("marks a rising cost as bad even though it points up", () => {
      // PR #5737 review's own proof case: "Total cost $170 +3.9%" must render bad/red, not green.
      expect(deltaTrend(3.9, costAvg)).toEqual({ direction: "up", isGood: false });
    });

    it("marks a falling cost as good even though it points down", () => {
      // PR #5737 review's own proof case: "Avg cost/trace $0.020 -5%" must render good/green, not red.
      expect(deltaTrend(-5, costAvg)).toEqual({ direction: "down", isGood: true });
    });
  });

  describe("given a metric where up is good (throughput)", () => {
    it("marks a rising value as good", () => {
      expect(deltaTrend(12, throughputAvg)).toEqual({ direction: "up", isGood: true });
    });

    it("marks a falling value as bad", () => {
      expect(deltaTrend(-12, throughputAvg)).toEqual({ direction: "down", isGood: false });
    });
  });
});

describe("runStubQuery", () => {
  const window: StubWindow = {
    startDate: new Date("2026-07-01T00:00:00Z"),
    endDate: new Date("2026-07-08T00:00:00Z"),
    days: 7,
  };

  const baseSpec: WidgetSpec = {
    id: "w1",
    title: "Cost by model",
    visualization: "stat",
    aggregations: [{ op: "avg", column: "cost" }],
    groupBy: [],
    filter: "",
    timeRangeMode: "inherit",
    colSpan: 4,
    rowSpan: 2,
  };

  describe("given specs that differ only by filter text", () => {
    it("returns identical results, since the stub does not parse Liqe syntax", () => {
      const noFilter = runStubQuery(baseSpec, window);
      const trailingZero = runStubQuery({ ...baseSpec, filter: "cost:>0.10" }, window);
      const noTrailingZero = runStubQuery({ ...baseSpec, filter: "cost:>0.1" }, window);
      const nonsense = runStubQuery({ ...baseSpec, filter: "zzzzzz" }, window);

      expect(trailingZero).toEqual(noFilter);
      expect(noTrailingZero).toEqual(noFilter);
      expect(nonsense).toEqual(noFilter);
    });
  });
});
