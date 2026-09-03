import { describe, expect, it } from "vitest";
import { analyticsTimeseriesInputSchema } from "../index";

describe("Analytics timeseries contract", () => {
  it("requires a tenant and timezone while defaulting filters", () => {
    const parsed = analyticsTimeseriesInputSchema.parse({
      projectId: "project-1",
      startDate: 1,
      endDate: 2,
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      timeZone: "UTC",
    });

    expect(parsed.filters).toEqual({});
  });

  it("rejects unknown top-level fields", () => {
    expect(() =>
      analyticsTimeseriesInputSchema.parse({
        projectId: "project-1",
        startDate: 1,
        endDate: 2,
        series: [],
        timeZone: "UTC",
        savedChartId: "not-analytics",
      }),
    ).toThrow();
  });
});
