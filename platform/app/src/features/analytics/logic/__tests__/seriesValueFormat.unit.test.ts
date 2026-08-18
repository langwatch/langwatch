import { describe, expect, it } from "vitest";
import { resolveSeriesValueFormat } from "../seriesValueFormat";

describe("resolveSeriesValueFormat", () => {
  const formatOf = ({
    format,
    value,
  }: {
    format: ReturnType<typeof resolveSeriesValueFormat>;
    value: number;
  }) => {
    if (typeof format !== "function") throw new Error("expected a formatter");
    return format(value);
  };

  describe("given a percentage series", () => {
    /** @scenario "A percentage series formats its values as a percentage" */
    it("suffixes the query's 0-100 value regardless of the metric's own format", () => {
      const format = resolveSeriesValueFormat({
        isPercent: true,
        aggregation: "avg",
        metricFormat: "0.00a",
      });

      // The builder already emits `filtered / all * 100`; a numeral `%`
      // token would multiply again and render 50 as "5000%".
      expect(formatOf({ format, value: 50 })).toBe("50%");
      expect(formatOf({ format, value: 0 })).toBe("0%");
    });

    it("wins over a cardinality aggregation", () => {
      const format = resolveSeriesValueFormat({
        isPercent: true,
        aggregation: "cardinality",
        metricFormat: "0.00a",
      });

      expect(formatOf({ format, value: 33.4 })).toBe("33%");
    });

    it("formats as a percentage even with no known metric", () => {
      const format = resolveSeriesValueFormat({
        isPercent: true,
        aggregation: "avg",
      });

      expect(formatOf({ format, value: 100 })).toBe("100%");
    });
  });

  describe("given a cardinality aggregation with no percent flag", () => {
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
