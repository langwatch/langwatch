import { describe, expect, it } from "vitest";
import { deriveSeriesIdentifier } from "../graph-alert";

describe("deriveSeriesIdentifier", () => {
  it("uses a custom key before the metric and retains the aggregation", () => {
    expect(
      deriveSeriesIdentifier(
        { series: [{ key: "vendor/model", metric: "ignored", aggregation: "avg" }] },
        0,
      ),
    ).toBe("0/vendor/model/avg");
  });

  it("uses metric, value, and count fallbacks for sparse series", () => {
    expect(
      deriveSeriesIdentifier(
        { series: [{ metric: "performance.total_cost", aggregation: "sum" }] },
        0,
      ),
    ).toBe("0/performance.total_cost/sum");
    expect(deriveSeriesIdentifier({ series: [{ aggregation: "p95" }] }, 0)).toBe("0/value/p95");
    expect(deriveSeriesIdentifier({ series: [{ key: "trace_id" }] }, 0)).toBe("0/trace_id/count");
  });

  it("declines malformed graphs and indexes outside the series array", () => {
    expect(deriveSeriesIdentifier(null, 0)).toBeUndefined();
    expect(deriveSeriesIdentifier("not-a-graph", 0)).toBeUndefined();
    expect(deriveSeriesIdentifier({ series: {} }, 0)).toBeUndefined();
    expect(deriveSeriesIdentifier({ series: [{ key: "a" }] }, 3)).toBeUndefined();
  });
});
