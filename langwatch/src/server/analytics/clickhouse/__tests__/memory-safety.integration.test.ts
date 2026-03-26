/**
 * Memory-budgeted integration smoke tests for ClickHouse analytics queries.
 *
 * Validates that all analytics query paths produce valid SQL, complete within
 * memory and time budgets, and return correct results on seeded data.
 *
 * @see specs/analytics/clickhouse-memory-safety.feature (Layer 2: @integration scenarios)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  getTestClickHouseClient,
  cleanupTestData,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import type { AggregationTypes } from "../../types";
import type { SeriesInputType } from "../../registry";
import { seedSpans } from "./test-utils/clickhouse-fixtures";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";

const TENANT_ID = "memory-safety-test";

/**
 * Representative analytics query definitions covering all major metric prefixes.
 *
 * Each entry exercises a distinct code path in metric-translator.ts.
 * Metrics requiring keys (evaluations, events) supply test values.
 */
const REPRESENTATIVE_METRICS: Array<{
  label: string;
  series: SeriesInputType[];
}> = [
  {
    label: "metadata.trace_id (cardinality)",
    series: [
      {
        metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
      },
    ],
  },
  {
    label: "metadata.user_id (cardinality)",
    series: [
      {
        metric: "metadata.user_id" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
      },
    ],
  },
  {
    label: "metadata.thread_id (cardinality)",
    series: [
      {
        metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
      },
    ],
  },
  {
    label: "metadata.span_type (cardinality)",
    series: [
      {
        metric: "metadata.span_type" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.completion_time (avg)",
    series: [
      {
        metric: "performance.completion_time" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.total_cost (sum)",
    series: [
      {
        metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
        aggregation: "sum" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.prompt_tokens (sum)",
    series: [
      {
        metric: "performance.prompt_tokens" as FlattenAnalyticsMetricsEnum,
        aggregation: "sum" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.completion_tokens (sum)",
    series: [
      {
        metric: "performance.completion_tokens" as FlattenAnalyticsMetricsEnum,
        aggregation: "sum" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.total_tokens (sum)",
    series: [
      {
        metric: "performance.total_tokens" as FlattenAnalyticsMetricsEnum,
        aggregation: "sum" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.first_token (avg)",
    series: [
      {
        metric: "performance.first_token" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
      },
    ],
  },
  {
    label: "performance.tokens_per_second (avg)",
    series: [
      {
        metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
      },
    ],
  },
  {
    label: "sentiment.thumbs_up_down (avg)",
    series: [
      {
        metric: "sentiment.thumbs_up_down" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
      },
    ],
  },
  {
    label: "events.event_type (cardinality)",
    series: [
      {
        metric: "events.event_type" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
        key: "test_event",
      },
    ],
  },
  {
    label: "events.event_score (avg)",
    series: [
      {
        metric: "events.event_score" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
        key: "test_event",
        subkey: "vote",
      },
    ],
  },
  {
    label: "events.event_details (cardinality)",
    series: [
      {
        metric: "events.event_details" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
        key: "test_event",
        subkey: "detail_key",
      },
    ],
  },
  {
    label: "evaluations.evaluation_score (avg)",
    series: [
      {
        metric: "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
        key: "eval-1",
      },
    ],
  },
  {
    label: "evaluations.evaluation_pass_rate (avg)",
    series: [
      {
        metric:
          "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
        key: "eval-1",
      },
    ],
  },
  {
    label: "evaluations.evaluation_runs (cardinality)",
    series: [
      {
        metric: "evaluations.evaluation_runs" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality" as AggregationTypes,
      },
    ],
  },
  {
    label: "threads.average_duration_per_thread (avg)",
    series: [
      {
        metric:
          "threads.average_duration_per_thread" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg" as AggregationTypes,
      },
    ],
  },
];

/** Base query input shared across all tests */
const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
  timeScale: 60 as number | "full",
};

/**
 * Build a timeseries query for a given set of series, resetting param counter
 * for deterministic output.
 */
function buildQuery(series: SeriesInputType[]) {
  resetParamCounter();
  return buildTimeseriesQuery({
    ...baseInput,
    series,
  });
}

describe("memory-safety integration", () => {
  let ch: ClickHouseClient;

  beforeAll(
    async () => {
      const rawClient = getTestClickHouseClient();
      if (!rawClient) throw new Error("ClickHouse client not available");
      ch = wrapWithDefaultSettings(rawClient);

      // Seed 10K spans with 50 attribute keys across 1000 traces
      // knownCost: 0.05 per trace so total_cost = 1000 * 0.05 = 50.0
      await seedSpans(ch, {
        tenantId: TENANT_ID,
        count: 10_000,
        attributeKeys: 50,
        attributeValueSize: 100,
        traceCount: 1000,
        knownCost: 0.05,
      });
    },
    120_000, // 2 minutes for seeding
  );

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("when executing generated analytics queries against ClickHouse", () => {
    for (const { label, series } of REPRESENTATIVE_METRICS) {
      it(`executes valid SQL for ${label}`, async () => {
        const { sql, params } = buildQuery(series);

        // Execute the query — ClickHouse will throw on syntax/schema errors
        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });

        // Drain the result to ensure full execution
        await result.json();
      });
    }
  });

  describe("when executing analytics queries with a tight memory budget", () => {
    // Seed additional wide data for memory budget tests
    let wideDataSeeded = false;
    const WIDE_TENANT_ID = "memory-safety-wide-test";

    beforeAll(
      async () => {
        await seedSpans(ch, {
          tenantId: WIDE_TENANT_ID,
          count: 10_000,
          attributeKeys: 50,
          attributeValueSize: 4096,
          traceCount: 1000,
        });
        wideDataSeeded = true;
      },
      120_000,
    );

    afterAll(async () => {
      if (wideDataSeeded) {
        await cleanupTestData(WIDE_TENANT_ID);
      }
    });

    for (const { label, series } of REPRESENTATIVE_METRICS) {
      it(`completes ${label} within 50MB memory budget`, async () => {
        resetParamCounter();
        const { sql, params } = buildTimeseriesQuery({
          ...baseInput,
          projectId: WIDE_TENANT_ID,
          series,
        });

        // Execute with strict memory budget.
        // ClickHouse throws MEMORY_LIMIT_EXCEEDED if the query uses > 50MB.
        try {
          const result = await ch.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: {
              max_memory_usage: "50000000",
            },
          });
          await result.json();
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (message.includes("MEMORY_LIMIT_EXCEEDED")) {
            expect.fail(
              `Query "${label}" exceeded 50MB memory budget: ${message}`,
            );
          }
          // Re-throw non-memory errors (these are real bugs)
          throw error;
        }
      });
    }
  });

  describe("when checking query execution time on seeded data", () => {
    const TIME_BUDGET_MS = 5_000;

    for (const { label, series } of REPRESENTATIVE_METRICS) {
      it(`completes ${label} within ${TIME_BUDGET_MS}ms`, async () => {
        const { sql, params } = buildQuery(series);

        const start = performance.now();
        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });
        await result.json();
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Column pruning: wide SpanAttributes should not be read for metrics that
  // only need trace_summaries columns (e.g. total_cost, token counts).
  // ---------------------------------------------------------------------------
  describe("when proving column pruning prevents OOM on wide SpanAttributes data", () => {
    const WIDE_COLUMN_TENANT_ID = "memory-safety-wide-column-test";

    beforeAll(
      async () => {
        // Seed spans with 50 attribute keys × 4KB per value ≈ 200KB per span.
        // This data set would cause OOM if analytics queries read SpanAttributes
        // without key-level pruning on metrics that don't need it.
        await seedSpans(ch, {
          tenantId: WIDE_COLUMN_TENANT_ID,
          count: 1_000,
          attributeKeys: 50,
          attributeValueSize: 4096,
          traceCount: 100,
        });
      },
      120_000,
    );

    afterAll(async () => {
      await cleanupTestData(WIDE_COLUMN_TENANT_ID);
    });

    it("generates SQL that does not reference SpanAttributes for total_cost metric", () => {
      resetParamCounter();
      const { sql } = buildTimeseriesQuery({
        ...baseInput,
        projectId: WIDE_COLUMN_TENANT_ID,
        timeScale: "full",
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
        ],
      });

      // total_cost reads TotalCost from trace_summaries — SpanAttributes must
      // not appear at all since that column lives in stored_spans.
      expect(sql).not.toContain("SpanAttributes");
    });

    it("completes total_cost query within 50MB on wide-attribute data", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        projectId: WIDE_COLUMN_TENANT_ID,
        timeScale: "full",
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
        ],
      });

      // Execute with a 50MB hard cap. If SpanAttributes were read without
      // column pruning this would exceed the budget on 1000 spans × 200KB.
      try {
        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
          clickhouse_settings: {
            max_memory_usage: "50000000",
          },
        });
        await result.json();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.includes("MEMORY_LIMIT_EXCEEDED")) {
          expect.fail(
            `total_cost query exceeded 50MB on wide-attribute data — ` +
              `column pruning may be broken: ${message}`,
          );
        }
        throw error;
      }
    });

    it("completes tokens_per_second query within 50MB on wide-attribute data", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        projectId: WIDE_COLUMN_TENANT_ID,
        timeScale: "full",
        series: [
          {
            metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
          },
        ],
      });

      // Execute with a 50MB hard cap. If stored_spans were read instead of
      // trace_summaries, the wide SpanAttributes column would cause OOM.
      try {
        const result = await ch.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
          clickhouse_settings: {
            max_memory_usage: "50000000",
          },
        });
        await result.json();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message.includes("MEMORY_LIMIT_EXCEEDED")) {
          expect.fail(
            `tokens_per_second query exceeded 50MB on wide-attribute data — ` +
              `it may be reading stored_spans instead of trace_summaries: ${message}`,
          );
        }
        throw error;
      }
    });
  });

  describe("when verifying tokens_per_second uses trace_summaries instead of stored_spans", () => {
    it("generates SQL that does not reference SpanAttributes for tokens_per_second metric with avg aggregation", () => {
      resetParamCounter();
      const { sql } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full",
        series: [
          {
            metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
          },
        ],
      });

      // tokens_per_second reads TokensPerSecond from trace_summaries —
      // SpanAttributes must not appear since that column lives in stored_spans.
      expect(sql).not.toContain("SpanAttributes");
      expect(sql).not.toMatch(/\bstored_spans\b/);
      expect(sql).toContain("TokensPerSecond");
    });

    it("generates SQL that does not reference SpanAttributes for tokens_per_second metric with p95 aggregation", () => {
      resetParamCounter();
      const { sql } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full",
        series: [
          {
            metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
            aggregation: "p95" as AggregationTypes,
          },
        ],
      });

      expect(sql).not.toContain("SpanAttributes");
      expect(sql).toContain("TokensPerSecond");
      expect(sql).toContain("quantileExact");
    });
  });

  describe("when verifying query result correctness on seeded data", () => {
    it("returns expected trace_count for cardinality of metadata.trace_id", async () => {
      // Use "full" timeScale to get a single aggregation across all time
      resetParamCounter();
      const fullQuery = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full",
        series: [
          {
            metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as AggregationTypes,
          },
        ],
      });

      const fullResult = await ch.query({
        query: fullQuery.sql,
        query_params: fullQuery.params,
        format: "JSONEachRow",
      });

      const fullRows = await fullResult.json<Record<string, unknown>>();
      // Find the current period row
      const currentRow = fullRows.find(
        (r: Record<string, unknown>) => r.period === "current",
      );
      expect(currentRow).toBeDefined();

      // Extract the cardinality value
      const metricKey = Object.keys(currentRow!).find(
        (k) => k !== "period" && k !== "date",
      );
      expect(metricKey).toBeDefined();
      expect(Number(currentRow![metricKey!])).toBe(1000);
    });

    it("returns expected total_cost sum", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full",
        series: [
          {
            metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
            aggregation: "sum" as AggregationTypes,
          },
        ],
      });

      const result = await ch.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = await result.json<Record<string, unknown>>();
      const currentRow = rows.find(
        (r: Record<string, unknown>) => r.period === "current",
      );
      expect(currentRow).toBeDefined();

      const metricKey = Object.keys(currentRow!).find(
        (k) => k !== "period" && k !== "date",
      );
      expect(metricKey).toBeDefined();

      // knownCost = 0.05 per trace, 1000 traces = 50.0
      const totalCost = Number(currentRow![metricKey!]);
      expect(totalCost).toBeCloseTo(50.0, 1);
    });

    it("returns expected avg tokens_per_second of 100", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        timeScale: "full",
        series: [
          {
            metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as AggregationTypes,
          },
        ],
      });

      const result = await ch.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = await result.json<Record<string, unknown>>();
      const currentRow = rows.find(
        (r: Record<string, unknown>) => r.period === "current",
      );
      expect(currentRow).toBeDefined();

      const metricKey = Object.keys(currentRow!).find(
        (k) => k !== "period" && k !== "date",
      );
      expect(metricKey).toBeDefined();

      // All trace_summaries rows have TokensPerSecond: 100 — avg must equal 100
      const avgTps = Number(currentRow![metricKey!]);
      expect(avgTps).toBeCloseTo(100, 0);
    });
  });
});
