import { describe, expect, it } from "vitest";
import { parseTimeseriesRows } from "../src/repositories/timeseries-row-parser";

describe("Analytics timeseries row compatibility", () => {
  it("keeps current and previous bucket ordering and preserves nullable metrics", () => {
    const result = parseTimeseriesRows({
      rows: [
        { period: "previous", date: "2026-01-01", "0__performance_completion_time__avg": null },
        { period: "current", date: "2026-01-03", "0__performance_total_cost__sum": "3" },
        { period: "current", date: "2026-01-02", "0__performance_total_cost__sum": "2" },
      ],
      series: [
        { metric: "performance.total_cost", aggregation: "sum" },
        { metric: "performance.completion_time", aggregation: "avg" },
      ],
      groupBy: undefined,
      timeScale: 24 * 60,
    });

    expect(result.previousPeriod).toEqual([
      {
        date: "2026-01-01",
        "0/performance.total_cost/sum": 0,
      },
    ]);
    expect(result.currentPeriod).toEqual([
      {
        date: "2026-01-02",
        "0/performance.total_cost/sum": 2,
      },
      {
        date: "2026-01-03",
        "0/performance.total_cost/sum": 3,
      },
    ]);
  });

  it("does not invent groups from the other period", () => {
    const result = parseTimeseriesRows({
      rows: [
        { period: "previous", date: "2026-01-01", group_key: "old", "0__performance_total_cost__sum": "1" },
        { period: "current", date: "2026-01-01", group_key: "new", "0__performance_total_cost__sum": "2" },
      ],
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      groupBy: "metadata.user_id",
      timeScale: 24 * 60,
    });

    expect(result.previousPeriod[0]?.["metadata.user_id"]).toEqual({
      old: { "0/performance.total_cost/sum": 1 },
    });
    expect(result.currentPeriod[0]?.["metadata.user_id"]).toEqual({
      new: { "0/performance.total_cost/sum": 2 },
    });
  });

  it("keeps the legacy malformed-cell fallback instead of changing a read into an error", () => {
    const result = parseTimeseriesRows({
      rows: [
        {
          period: 99,
          date: 42,
          group_key: true,
          "0__performance_total_cost__sum": "2",
        },
        {
          period: "current",
          date: "2026-01-01",
          group_key: "current",
          "0__performance_total_cost__sum": "3",
        },
      ],
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      groupBy: "metadata.user_id",
      timeScale: 24 * 60,
    });

    expect(result).toEqual({
      previousPeriod: [
        {
          date: "",
          "metadata.user_id": {
            true: { "0/performance.total_cost/sum": 2 },
          },
        },
      ],
      currentPeriod: [
        {
          date: "2026-01-01",
          "metadata.user_id": {
            current: { "0/performance.total_cost/sum": 3 },
          },
        },
      ],
    });
  });
});
