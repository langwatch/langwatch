import { describe, expect, it } from "vitest";
import { deriveSeriesOptionsFromGraph, resolveSeriesLabel } from "../src/graph-series";

describe("graph series presentation", () => {
  const graph = {
    series: [
      { name: "p95 latency", metric: "latency", aggregation: "p95" },
      { metric: "metadata.trace_id", aggregation: "cardinality" },
    ],
  };

  it("keeps named and fallback labels paired with their canonical keys", () => {
    expect(deriveSeriesOptionsFromGraph(graph)).toEqual([
      { key: "0/latency/p95", label: "p95 latency" },
      {
        key: "1/metadata.trace_id/cardinality",
        label: "Series 2: metadata.trace_id / cardinality",
      },
    ]);

    expect(
      deriveSeriesOptionsFromGraph({
        series: [{ name: "Custom", key: "eval-checker-1", aggregation: "avg" }],
      }),
    ).toEqual([{ key: "0/eval-checker-1/avg", label: "Custom" }]);
  });

  it("returns no option for malformed graphs and no label for a stale key", () => {
    expect(deriveSeriesOptionsFromGraph(null)).toEqual([]);
    expect(deriveSeriesOptionsFromGraph("not-a-graph")).toEqual([]);
    expect(deriveSeriesOptionsFromGraph({ series: "oops" })).toEqual([]);
    expect(deriveSeriesOptionsFromGraph({ series: [] })).toEqual([]);
    expect(
      deriveSeriesOptionsFromGraph({
        series: [{ name: "", metric: "latency", aggregation: "avg" }],
      }),
    ).toEqual([{ key: "0/latency/avg", label: "Series 1: latency / avg" }]);
    expect(resolveSeriesLabel(graph, "0/latency/p95")).toBe("p95 latency");
    expect(resolveSeriesLabel(graph, "1/metadata.trace_id/cardinality")).toBe(
      "Series 2: metadata.trace_id / cardinality",
    );
    expect(resolveSeriesLabel(graph, "2/gone/sum")).toBeNull();
    expect(resolveSeriesLabel(graph, "1/latency/p95")).toBeNull();
    expect(resolveSeriesLabel(graph, "")).toBeNull();
    expect(resolveSeriesLabel(null, "0/latency/p95")).toBeNull();
  });
});
