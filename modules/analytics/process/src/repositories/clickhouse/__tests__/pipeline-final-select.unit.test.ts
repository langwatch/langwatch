import { beforeEach, describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";

type TimeseriesInput = Parameters<typeof buildTimeseriesQuery>[0];

const threadsPerUser = {
  metric: "metadata.thread_id",
  aggregation: "cardinality",
  pipeline: { field: "user_id", aggregation: "avg" },
} satisfies TimeseriesInput["series"][number];

const tracesPerUser = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
  pipeline: { field: "user_id", aggregation: "max" },
} satisfies TimeseriesInput["series"][number];

const traceCount = {
  metric: "metadata.trace_id",
  aggregation: "cardinality",
} satisfies TimeseriesInput["series"][number];

const hourlyInput = (series: TimeseriesInput["series"]): TimeseriesInput => ({
  projectId: "test-project",
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-02T00:00:00Z"),
  previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
  series,
  timeScale: 60,
});

const finalSelectOf = (sql: string): string => sql.slice(sql.lastIndexOf("SELECT "));

describe("buildTimeseriesQuery() date-bucketed pipeline final select", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("when one pipeline metric stands alone", () => {
    it("reads the pipeline CTE directly without a join", () => {
      const { sql } = buildTimeseriesQuery(hourlyInput([threadsPerUser]));

      expect(finalSelectOf(sql)).toBe(
        "SELECT * FROM cte_0__metadata_thread_id__cardinality WHERE period IS NOT NULL ORDER BY period, date\n  ",
      );
    });
  });

  describe("when two pipeline metrics are requested", () => {
    it("anchors on the first pipeline CTE and full-outer-joins the second", () => {
      const { sql } = buildTimeseriesQuery(hourlyInput([threadsPerUser, tracesPerUser]));
      const finalSelect = finalSelectOf(sql);

      expect(finalSelect).toContain(
        "SELECT cte_0__metadata_thread_id__cardinality.period, cte_0__metadata_thread_id__cardinality.date, cte_0__metadata_thread_id__cardinality.`0__metadata_thread_id__cardinality`",
      );
      expect(finalSelect).toContain(
        "FULL OUTER JOIN cte_1__metadata_trace_id__cardinality ON cte_0__metadata_thread_id__cardinality.period = cte_1__metadata_trace_id__cardinality.period AND cte_0__metadata_thread_id__cardinality.date = cte_1__metadata_trace_id__cardinality.date",
      );
    });
  });

  describe("when a simple metric is mixed with a pipeline metric", () => {
    it("anchors on simple_metrics and joins every pipeline CTE", () => {
      const { sql } = buildTimeseriesQuery(hourlyInput([traceCount, threadsPerUser]));
      const finalSelect = finalSelectOf(sql);

      expect(sql).toContain("simple_metrics AS (");
      expect(finalSelect).toContain(
        "SELECT simple_metrics.period, simple_metrics.date, simple_metrics.`0__metadata_trace_id__cardinality`",
      );
      expect(finalSelect).toContain(
        "FULL OUTER JOIN cte_1__metadata_thread_id__cardinality ON simple_metrics.period = cte_1__metadata_thread_id__cardinality.period",
      );
      expect(finalSelect).toContain("WHERE simple_metrics.period IS NOT NULL");
    });
  });
});
