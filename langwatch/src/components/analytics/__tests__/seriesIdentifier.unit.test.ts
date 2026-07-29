import { describe, expect, it } from "vitest";

import { deriveSeriesIdentifier } from "../seriesIdentifier";

describe("deriveSeriesIdentifier", () => {
  describe("given a graph whose series entry has a key", () => {
    const graph = {
      series: [
        { key: "vendor/model", metric: "metadata.value", aggregation: "avg" },
      ],
    };

    describe("when deriving the identifier for that index", () => {
      it("uses the key over the metric", () => {
        expect(deriveSeriesIdentifier(graph, 0)).toBe("0/vendor/model/avg");
      });
    });
  });

  describe("given a series entry with an empty key and a metric", () => {
    const graph = {
      series: [{ key: "", metric: "performance.total_cost", aggregation: "sum" }],
    };

    describe("when deriving the identifier", () => {
      it("falls back to the metric", () => {
        expect(deriveSeriesIdentifier(graph, 0)).toBe(
          "0/performance.total_cost/sum",
        );
      });
    });
  });

  describe("given a series entry with neither key nor metric", () => {
    const graph = { series: [{ aggregation: "p95" }] };

    describe("when deriving the identifier", () => {
      it('falls back to "value"', () => {
        expect(deriveSeriesIdentifier(graph, 0)).toBe("0/value/p95");
      });
    });
  });

  describe("given a series entry without an aggregation", () => {
    const graph = { series: [{ key: "trace_id" }] };

    describe("when deriving the identifier", () => {
      it('falls back to "count"', () => {
        expect(deriveSeriesIdentifier(graph, 0)).toBe("0/trace_id/count");
      });
    });
  });

  describe("given malformed input", () => {
    describe("when the graph is not an object", () => {
      it("returns undefined for null", () => {
        expect(deriveSeriesIdentifier(null, 0)).toBeUndefined();
      });

      it("returns undefined for a string", () => {
        expect(deriveSeriesIdentifier("not-a-graph", 0)).toBeUndefined();
      });
    });

    describe("when the series field is not an array", () => {
      it("returns undefined", () => {
        expect(deriveSeriesIdentifier({ series: {} }, 0)).toBeUndefined();
      });
    });

    describe("when the index is out of range", () => {
      it("returns undefined", () => {
        expect(
          deriveSeriesIdentifier({ series: [{ key: "a" }] }, 3),
        ).toBeUndefined();
      });
    });
  });
});
