import { describe, expect, it } from "vitest";
import { findSeriesIdentifier } from "../graph-alert.ts";

describe("findSeriesIdentifier", () => {
  it("uses a custom key before the metric and retains the aggregation", () => {
    expect(
      findSeriesIdentifier(
        { series: [{ key: "vendor/model", metric: "ignored", aggregation: "avg" }] },
        0,
      ),
    ).toBe("0/vendor/model/avg");
  });

  it("uses metric, value, and count fallbacks for sparse series", () => {
    expect(
      findSeriesIdentifier(
        { series: [{ metric: "performance.total_cost", aggregation: "sum" }] },
        0,
      ),
    ).toBe("0/performance.total_cost/sum");
    expect(findSeriesIdentifier({ series: [{ aggregation: "p95" }] }, 0)).toBe("0/value/p95");
    expect(findSeriesIdentifier({ series: [{ key: "trace_id" }] }, 0)).toBe("0/trace_id/count");
  });

  it("declines malformed graphs and indexes outside the series array", () => {
    expect(findSeriesIdentifier(null, 0)).toBeUndefined();
    expect(findSeriesIdentifier("not-a-graph", 0)).toBeUndefined();
    expect(findSeriesIdentifier({ series: {} }, 0)).toBeUndefined();
    expect(findSeriesIdentifier({ series: [{ key: "a" }] }, 3)).toBeUndefined();
  });
});
