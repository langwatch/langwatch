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
});

describe("withGroupedPipeline", () => {
  describe("given a pie chart grouped by a field, with no pipeline of its own", () => {
    it("injects the default sum-over-trace_id pipeline on every series", () => {
      const input = makeInput({ graphType: "pie", groupBy: "metadata.model" });

      const result = withGroupedPipeline(input);

      expect(result.series[0]!.pipeline).toEqual({
        field: "trace_id",
        aggregation: "sum",
      });
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
