import { describe, it } from "vitest";
import { buildTimeseriesQuery } from "../aggregation-builder";

describe("debug SQL", () => {
  it("should log SQL for User Threads metrics (with pipeline)", () => {
    const input = {
      projectId: "test-project",
      startDate: new Date("2024-01-02T00:00:00Z"),
      endDate: new Date("2024-01-03T00:00:00Z"),
      previousPeriodStartDate: new Date("2024-01-01T00:00:00Z"),
      series: [
        { metric: "metadata.thread_id" as const, aggregation: "cardinality" as const },
        { metric: "metadata.thread_id" as const, aggregation: "cardinality" as const, pipeline: { field: "user_id" as const, aggregation: "avg" as const } },
        { metric: "threads.average_duration_per_thread" as const, aggregation: "avg" as const, pipeline: { field: "user_id" as const, aggregation: "avg" as const } },
        { metric: "metadata.trace_id" as const, aggregation: "cardinality" as const, pipeline: { field: "user_id" as const, aggregation: "avg" as const } },
      ],
      timeScale: "full" as const,
    };

    const result = buildTimeseriesQuery(input);
    console.log("===== USER THREADS SQL =====");
    console.log(result.sql);
    console.log("===== END SQL =====");
  });
});
