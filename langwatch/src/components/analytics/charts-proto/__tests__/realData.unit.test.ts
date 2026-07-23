import { describe, expect, it } from "vitest";
import { aggAlias, type WidgetSpec } from "../model";
import { buildTraceQueryRequest, rowsToWidgetResult } from "../realData";
import type { StubWindow } from "../stubData";

const countAlias = aggAlias({ op: "count" }, 0);

const window: StubWindow = {
  startDate: new Date("2026-07-01T00:00:00Z"),
  endDate: new Date("2026-07-08T00:00:00Z"),
  days: 7,
};

const baseSpec: WidgetSpec = {
  id: "w1",
  title: "Cost by model",
  visualization: "bar",
  aggregations: [{ op: "avg", column: "cost" }],
  groupBy: ["model"],
  filter: "",
  timeRangeMode: "inherit",
  colSpan: 6,
  rowSpan: 2,
  useRealData: true,
};

describe("buildTraceQueryRequest", () => {
  describe("given a widget spec with a filter and a group-by", () => {
    it("carries an explicit alias per aggregation and the window as epoch-ms timeRange", () => {
      const spec: WidgetSpec = { ...baseSpec, filter: "cost:>0.1" };
      const req = buildTraceQueryRequest(spec, window);

      expect(req.aggregations).toEqual([{ op: "avg", column: "cost", alias: "avg_cost_0" }]);
      expect(req.groupBy).toEqual(["model"]);
      expect(req.filter).toBe("cost:>0.1");
      expect(req.timeRange).toEqual({
        from: window.startDate.getTime(),
        to: window.endDate.getTime(),
      });
    });
  });

  describe("given an empty filter and no group-by", () => {
    it("omits both rather than sending empty-string/empty-array", () => {
      const spec: WidgetSpec = { ...baseSpec, filter: "  ", groupBy: [] };
      const req = buildTraceQueryRequest(spec, window);

      expect(req.filter).toBeUndefined();
      expect(req.groupBy).toBeUndefined();
    });
  });
});

describe("rowsToWidgetResult", () => {
  describe("given real rows grouped by a dimension", () => {
    it("maps each row to a group keyed by the aggregation's alias, sorted descending by the primary metric", () => {
      const rows = [
        { model: "gpt-4o-mini", avg_cost_0: 0.004 },
        { model: "gpt-4o", avg_cost_0: 0.02 },
      ];
      const result = rowsToWidgetResult(baseSpec, rows);

      expect(result.groups.map((g) => g.label)).toEqual(["gpt-4o", "gpt-4o-mini"]);
      expect(result.groups[0]!.values.avg_cost_0).toBe(0.02);
      expect(result.buckets).toEqual([]);
    });
  });

  describe("given a hasError group-by dimension", () => {
    it("renders the raw ClickHouse boolean as an OK/Error label", () => {
      const spec: WidgetSpec = { ...baseSpec, groupBy: ["hasError"] };
      const rows = [
        { hasError: "true", avg_cost_0: 0.05 },
        { hasError: "false", avg_cost_0: 0.01 },
      ];
      const result = rowsToWidgetResult(spec, rows);

      expect(result.groups.map((g) => g.label)).toEqual(["Error", "OK"]);
    });
  });

  describe("given a count aggregation across groups (additive)", () => {
    it("sums group values for the single-stat total, not averages them", () => {
      const spec: WidgetSpec = { ...baseSpec, aggregations: [{ op: "count" }] };
      const rows = [
        { model: "gpt-4o", [countAlias]: 30 },
        { model: "gpt-4o-mini", [countAlias]: 70 },
      ];
      const result = rowsToWidgetResult(spec, rows);

      expect(result.total.value).toBe(100);
    });
  });

  describe("given an avg aggregation across groups (non-additive)", () => {
    it("averages group values for the single-stat total, not sums them", () => {
      const rows = [
        { model: "gpt-4o", avg_cost_0: 0.02 },
        { model: "gpt-4o-mini", avg_cost_0: 0.01 },
      ];
      const result = rowsToWidgetResult(baseSpec, rows);

      expect(result.total.value).toBeCloseTo(0.015);
    });
  });

  describe("given any real result", () => {
    it("has no fabricated delta -- 0, which the renderer shows as neutral, never a fake percentage", () => {
      const result = rowsToWidgetResult(baseSpec, [{ model: "gpt-4o", avg_cost_0: 0.02 }]);
      expect(result.total.deltaPct).toBe(0);
      expect(result.total.spark).toEqual([]);
    });
  });

  describe("given no rows at all", () => {
    it("returns an empty group list and a zero total instead of throwing", () => {
      const result = rowsToWidgetResult(baseSpec, []);
      expect(result.groups).toEqual([]);
      expect(result.total.value).toBe(0);
    });
  });
});
