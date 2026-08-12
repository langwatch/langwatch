import { describe, expect, it } from "vitest";
import { resolveSeriesValueFormat } from "../seriesValueFormat";

describe("resolveSeriesValueFormat", () => {
  describe("given a series with asPercent", () => {
    /** @scenario "A percentage series formats its values as a percentage" */
    it("formats as a percentage regardless of the metric's own format", () => {
      expect(
        resolveSeriesValueFormat({
          asPercent: true,
          aggregation: "avg",
          metricFormat: "0.00a",
        }),
      ).toBe("0%");
    });

    it("wins over a cardinality aggregation", () => {
      expect(
        resolveSeriesValueFormat({
          asPercent: true,
          aggregation: "cardinality",
          metricFormat: "0.00a",
        }),
      ).toBe("0%");
    });

    it("formats as a percentage even with no known metric", () => {
      expect(
        resolveSeriesValueFormat({ asPercent: true, aggregation: "avg" }),
      ).toBe("0%");
    });
  });

  describe("given a cardinality aggregation with no asPercent", () => {
    it("formats as an integer regardless of the metric's own format", () => {
      expect(
        resolveSeriesValueFormat({
          aggregation: "cardinality",
          metricFormat: "0.00a",
        }),
      ).toBe("0a");
    });
  });

  describe("given neither asPercent nor a cardinality aggregation", () => {
    it("keeps the metric's own string format", () => {
      expect(
        resolveSeriesValueFormat({ aggregation: "avg", metricFormat: "0.00a" }),
      ).toBe("0.00a");
    });

    it("keeps the metric's own formatter function", () => {
      const formatter = (value: number) => `${value}ms`;

      expect(
        resolveSeriesValueFormat({
          aggregation: "avg",
          metricFormat: formatter,
        }),
      ).toBe(formatter);
    });

    it("passes through undefined when the metric is unknown", () => {
      expect(resolveSeriesValueFormat({ aggregation: "avg" })).toBeUndefined();
    });
  });
});
