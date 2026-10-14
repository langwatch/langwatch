import { describe, expect, it } from "vitest";

import { describeFigure } from "../metric-figure.ts";

describe("describeFigure", () => {
  describe("when the metric is not a count of ids", () => {
    /** @scenario "A metrics card names its aggregation in words" */
    it.each([
      ["sum", "total"],
      ["avg", "average"],
      ["min", "minimum"],
      ["max", "maximum"],
      ["median", "median"],
      ["p95", "95th percentile"],
      ["p99", "99th percentile"],
      ["p1", "1st percentile"],
      ["p2", "2nd percentile"],
      ["p3", "3rd percentile"],
      ["p11", "11th percentile"],
    ])("captions %s as %s under the metric heading", (aggregation, caption) => {
      expect(
        describeFigure({
          metricKey: "performance.total_cost",
          aggregation: aggregation,
        }),
      ).toEqual({
        title: "Total cost",
        caption,
      });
    });

    /** @scenario "A metrics card names its aggregation in words" */
    it("shows an unknown aggregation with its separators as spaces", () => {
      expect(
        describeFigure({
          metricKey: "performance.completion_time",
          aggregation: "weighted_mean-v2",
        }),
      ).toEqual({ title: "Completion time", caption: "weighted mean v2" });
    });

    it("captions a distinct count as unique values of the metric", () => {
      expect(
        describeFigure({
          metricKey: "metadata.labels",
          aggregation: "cardinality",
        }),
      ).toEqual({
        title: "Labels",
        caption: "unique labels",
      });
    });

    it("captions a figure with no aggregation by the metric itself", () => {
      expect(
        describeFigure({
          metricKey: "performance.total_cost",
          aggregation: null,
        }),
      ).toEqual({
        title: "Total cost",
        caption: "total cost",
      });
    });
  });

  describe("when the metric is a count of ids", () => {
    it("titles and captions it as the entities counted", () => {
      expect(
        describeFigure({
          metricKey: "metadata.trace_id",
          aggregation: "cardinality",
        }),
      ).toEqual({
        title: "Traces",
        caption: "traces",
      });
    });

    it("keeps the metric heading for a non-count aggregation over the id", () => {
      expect(describeFigure({ metricKey: "metadata.trace_id", aggregation: "max" })).toEqual({
        title: "Trace id",
        caption: "maximum",
      });
    });
  });
});
