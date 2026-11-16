import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import type { TimeseriesQueryInput } from "../clickhouse.aggregation-builder.mapper.ts";
import { findPipelineParts, renumberedRows } from "../clickhouse.series-parts.mapper.ts";

const series = (metric: string, extra: Partial<AnalyticsSeries> = {}) =>
  ({ metric, aggregation: "sum", ...extra }) as AnalyticsSeries;
const perUser = series("performance.total_cost", {
  pipeline: { field: "user_id", aggregation: "avg" },
});
const input = (list: AnalyticsSeries[]) =>
  ({
    projectId: "project-1",
    startDate: new Date(0),
    endDate: new Date(1),
    previousPeriodStartDate: new Date(0),
    series: list,
    timeScale: 60,
  }) as TimeseriesQueryInput;

describe("findPipelineParts()", () => {
  describe("given pipelines beside other series", () => {
    it("reads the pipelines in one part and the rest in another, keeping each series' index", () => {
      const thumbs = series("sentiment.thumbs_up_down");
      const score = series("evaluations.evaluation_score", { key: "ev" });

      const parts = findPipelineParts(input([thumbs, perUser, score]));

      expect(parts.map((part) => [part.indexes, part.input.series])).toEqual([
        [[1], [perUser]],
        [
          [0, 2],
          [thumbs, score],
        ],
      ]);
    });
  });

  describe("given only pipelines, or no pipeline", () => {
    it("finds no parts", () => {
      expect(findPipelineParts(input([perUser]))).toEqual([]);
      expect(findPipelineParts(input([series("performance.total_cost")]))).toEqual([]);
    });
  });
});

describe("renumberedRows()", () => {
  it("renames each series key to the query's index and keeps the bucket keys", () => {
    const rows = renumberedRows(
      [{ period: "current", date: "d", group_key: "k", m0__a__sum: 1, m1__b__avg: 2 }],
      [3, 1],
    );

    expect(rows).toEqual([
      { period: "current", date: "d", group_key: "k", m3__a__sum: 1, m1__b__avg: 2 },
    ]);
  });
});
