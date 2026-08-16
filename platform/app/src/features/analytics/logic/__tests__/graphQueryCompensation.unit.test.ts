import { describe, expect, it } from "vitest";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import {
  resolveGraphTimeScale,
  withGroupedPipeline,
} from "../graphQueryCompensation";

function makeInput(
  overrides: Partial<CustomGraphInput> = {},
): CustomGraphInput {
  return {
    graphId: "graph-1",
    graphType: "line",
    series: [
      {
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        name: "Traces",
      },
    ] as CustomGraphInput["series"],
    includePrevious: false,
    timeScale: 60,
    ...overrides,
  };
}

describe("resolveGraphTimeScale", () => {
  describe("given a summary chart", () => {
    it("forces full resolution regardless of its stored numeric timeScale", () => {
      expect(
        resolveGraphTimeScale({ graphType: "summary", timeScale: 60 }),
      ).toBe("full");
    });
  });

  describe("given a non-summary chart with a numeric timeScale", () => {
    it("keeps the stored resolution", () => {
      expect(resolveGraphTimeScale({ graphType: "line", timeScale: 30 })).toBe(
        30,
      );
    });

    it("parses a stringly-typed numeric timeScale", () => {
      expect(
        resolveGraphTimeScale({
          graphType: "bar",
          timeScale: "30" as unknown as number,
        }),
      ).toBe(30);
    });
  });

  describe("given a chart already set to full", () => {
    it("leaves it as full", () => {
      expect(
        resolveGraphTimeScale({ graphType: "line", timeScale: "full" }),
      ).toBe("full");
    });
  });

  describe("given a day-or-coarser bucket over a short window", () => {
    it("downgrades to hourly so a two-day report is not one lonely bucket", () => {
      expect(
        resolveGraphTimeScale({
          graphType: "line",
          timeScale: 1440,
          daysDifference: 2,
        }),
      ).toBe(60);
    });

    it("leaves a longer window at its configured resolution", () => {
      expect(
        resolveGraphTimeScale({
          graphType: "line",
          timeScale: 1440,
          daysDifference: 10,
        }),
      ).toBe(1440);
    });

    it("leaves it alone when no window span is known", () => {
      expect(
        resolveGraphTimeScale({ graphType: "line", timeScale: 1440 }),
      ).toBe(1440);
    });
  });

  describe("given stored JSON whose timeScale is missing or mangled", () => {
    // Stored graph JSON is cast, not parsed — these arrive at runtime even
    // though the type says they can't.
    const badScale = (value: unknown) =>
      resolveGraphTimeScale({
        graphType: "line",
        timeScale: value as CustomGraphInput["timeScale"],
      });

    it("falls back to hourly rather than throwing on null or undefined", () => {
      expect(badScale(null)).toBe(60);
      expect(badScale(undefined)).toBe(60);
    });

    it("falls back to hourly rather than querying with NaN", () => {
      expect(badScale("not-a-number")).toBe(60);
    });

    it("falls back to hourly on a zero or negative bucket size", () => {
      expect(badScale(0)).toBe(60);
      expect(badScale(-1440)).toBe(60);
    });

    it("still reads a numeric string the way the UI stores one", () => {
      expect(badScale("1440")).toBe(1440);
    });
  });
});

describe("withGroupedPipeline", () => {
  describe("given a pie chart grouped by a field, with no pipeline of its own", () => {
    it("injects the default sum-over-trace_id pipeline on every series", () => {
      const input = makeInput({
        graphType: "pie",
        groupBy: "metadata.model",
        series: [
          {
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            name: "Traces",
          },
          {
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            name: "Also bare",
          },
        ] as CustomGraphInput["series"],
      });

      const result = withGroupedPipeline(input);

      for (const series of result.series) {
        expect(series.pipeline).toEqual({
          field: "trace_id",
          aggregation: "sum",
        });
      }
    });
  });

  describe("given a donut chart grouped by a field, with no pipeline of its own", () => {
    it("injects the default pipeline the same way as pie", () => {
      const input = makeInput({
        graphType: "donnut",
        groupBy: "metadata.model",
      });

      const result = withGroupedPipeline(input);

      expect(result.series[0]!.pipeline).toEqual({
        field: "trace_id",
        aggregation: "sum",
      });
    });
  });

  describe("given a pie chart with a pipeline already defined", () => {
    it("leaves the author's pipeline untouched", () => {
      const input = makeInput({
        graphType: "pie",
        groupBy: "metadata.model",
        series: [
          {
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            name: "Traces",
            pipeline: { field: "trace_id", aggregation: "avg" },
          },
        ] as CustomGraphInput["series"],
      });

      const result = withGroupedPipeline(input);

      expect(result.series[0]!.pipeline).toEqual({
        field: "trace_id",
        aggregation: "avg",
      });
    });
  });

  describe("given a grouped pie chart with one explicit pipeline and one series without", () => {
    it("fills only the missing pipeline, keeping the author's", () => {
      const input = makeInput({
        graphType: "pie",
        groupBy: "metadata.model",
        series: [
          {
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            name: "Traces",
            pipeline: { field: "trace_id", aggregation: "avg" },
          },
          {
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            name: "Bare",
          },
        ] as CustomGraphInput["series"],
      });

      const result = withGroupedPipeline(input);

      expect(result.series[0]!.pipeline).toEqual({
        field: "trace_id",
        aggregation: "avg",
      });
      expect(result.series[1]!.pipeline).toEqual({
        field: "trace_id",
        aggregation: "sum",
      });
    });
  });

  describe("given a pie chart with no groupBy", () => {
    it("leaves the input untouched — there is nothing to group", () => {
      const input = makeInput({ graphType: "pie" });

      expect(withGroupedPipeline(input)).toBe(input);
    });
  });

  describe("given a non-pie chart type", () => {
    it("leaves the input untouched even when grouped", () => {
      const input = makeInput({ graphType: "bar", groupBy: "metadata.model" });

      expect(withGroupedPipeline(input)).toBe(input);
    });
  });
});
