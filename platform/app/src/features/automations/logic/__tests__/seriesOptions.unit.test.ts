import { describe, expect, it } from "vitest";
import {
  deriveSeriesOptionsFromGraph,
  resolveSeriesLabel,
} from "../seriesOptions";

describe("deriveSeriesOptionsFromGraph", () => {
  describe("given a series with a human name", () => {
    it("uses the author's name as the label", () => {
      const options = deriveSeriesOptionsFromGraph({
        series: [
          { name: "p95 latency", metric: "latency", aggregation: "p95" },
        ],
      });

      expect(options).toEqual([{ key: "0/latency/p95", label: "p95 latency" }]);
    });

    it("prefers the name even over a series that also carries a key", () => {
      const options = deriveSeriesOptionsFromGraph({
        series: [
          {
            name: "Checker score",
            metric: "evaluations.evaluation_score",
            aggregation: "avg",
            key: "eval-checker-1",
          },
        ],
      });

      expect(options).toEqual([
        {
          key: "0/eval-checker-1/avg",
          label: "Checker score",
        },
      ]);
    });
  });

  describe("given an unnamed series", () => {
    it("falls back to the 'Series N: metric / aggregation' label", () => {
      const options = deriveSeriesOptionsFromGraph({
        series: [{ metric: "latency", aggregation: "p95" }],
      });

      expect(options).toEqual([
        { key: "0/latency/p95", label: "Series 1: latency / p95" },
      ]);
    });

    it("treats an empty-string name as unnamed and numbers the fallback 1-based", () => {
      const options = deriveSeriesOptionsFromGraph({
        series: [
          { name: "First", metric: "latency", aggregation: "p95" },
          {
            name: "",
            metric: "metadata.trace_id",
            aggregation: "cardinality",
          },
        ],
      });

      expect(options[1]).toEqual({
        key: "1/metadata.trace_id/cardinality",
        label: "Series 2: metadata.trace_id / cardinality",
      });
    });
  });

  describe("given a malformed or empty graph", () => {
    it("returns an empty list for a null graph", () => {
      expect(deriveSeriesOptionsFromGraph(null)).toEqual([]);
    });

    it("returns an empty list for a non-object graph", () => {
      expect(deriveSeriesOptionsFromGraph("not-a-graph")).toEqual([]);
    });

    it("returns an empty list when series is not an array", () => {
      expect(deriveSeriesOptionsFromGraph({ series: "oops" })).toEqual([]);
    });

    it("returns an empty list for an empty series array", () => {
      expect(deriveSeriesOptionsFromGraph({ series: [] })).toEqual([]);
    });
  });
});

describe("resolveSeriesLabel", () => {
  const graph = {
    series: [
      { name: "p95 latency", metric: "latency", aggregation: "p95" },
      { metric: "metadata.trace_id", aggregation: "cardinality" },
    ],
  };

  describe("given a key that matches a series", () => {
    it("returns the named series' label", () => {
      expect(resolveSeriesLabel(graph, "0/latency/p95")).toBe("p95 latency");
    });

    it("returns the fallback label for an unnamed matching series", () => {
      expect(
        resolveSeriesLabel(graph, "1/metadata.trace_id/cardinality"),
      ).toBe("Series 2: metadata.trace_id / cardinality");
    });
  });

  describe("given a key that no longer matches", () => {
    it("returns null when the series was deleted (index out of range)", () => {
      expect(resolveSeriesLabel(graph, "2/gone/sum")).toBeNull();
    });

    it("returns null when the series was reordered (right metric, wrong index)", () => {
      // `latency/p95` now lives at index 0; a stored key pointing at index 1
      // no longer resolves and falls back to null.
      expect(resolveSeriesLabel(graph, "1/latency/p95")).toBeNull();
    });

    it("returns null for an empty key", () => {
      expect(resolveSeriesLabel(graph, "")).toBeNull();
    });

    it("returns null when the graph itself is missing", () => {
      expect(resolveSeriesLabel(null, "0/latency/p95")).toBeNull();
    });
  });
});
