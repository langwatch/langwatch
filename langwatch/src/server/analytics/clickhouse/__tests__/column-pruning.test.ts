/**
 * Tests for ClickHouse analytics column pruning.
 *
 * Validates that analytics queries select only the columns they need,
 * avoiding expensive reads of wide columns like ComputedInput/ComputedOutput.
 *
 * @see specs/analytics/clickhouse-column-pruning.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetParamCounter } from "../filter-translator";
import {
  buildTimeseriesQuery,
} from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import {
  fieldMappings,
  TRACE_IDENTITY_COLUMNS,
} from "../field-mappings";

describe("column-pruning", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  const baseInput = {
    projectId: "test-project",
    startDate: new Date("2024-01-01T00:00:00Z"),
    endDate: new Date("2024-01-02T00:00:00Z"),
    previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
    timeScale: 60,
  };

  describe("trace dedup subquery column pruning", () => {
    describe("when requesting trace_count metric", () => {
      it("does not use SELECT * in the dedup subquery", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        });

        // The dedup subquery should not contain SELECT *
        expect(result.sql).not.toMatch(/SELECT\s+\*\s+FROM\s+trace_summaries/);
      });

      it("selects identity columns needed for deduplication", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        });

        // Identity columns must always be present
        expect(result.sql).toContain("TenantId");
        expect(result.sql).toContain("TraceId");
        expect(result.sql).toContain("OccurredAt");
        expect(result.sql).toContain("UpdatedAt");
      });

      it("does not include wide payload columns like ComputedInput", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        });

        // Wide columns should never appear in analytics queries
        expect(result.sql).not.toContain("ComputedInput");
        expect(result.sql).not.toContain("ComputedOutput");
      });
    });

    describe("when requesting total_cost grouped by metadata.user_id", () => {
      it("includes the column mapped to metadata.user_id", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
              aggregation: "sum" as const,
            },
          ],
          groupBy: "metadata.user_id",
        });

        // The Attributes map column must be present for user_id access
        expect(result.sql).toContain("Attributes");
      });

      it("includes the column mapped to total_cost", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum,
              aggregation: "sum" as const,
            },
          ],
          groupBy: "metadata.user_id",
        });

        expect(result.sql).toContain("TotalCost");
      });
    });

    describe("when requesting trace_count filtered by metadata.labels", () => {
      it("includes the column mapped to metadata.labels", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
          filters: {
            "metadata.labels": { "langwatch.labels": ["label-1"] },
          },
        });

        expect(result.sql).toContain("Attributes");
      });
    });
  });

  describe("evaluation runs subquery column pruning", () => {
    describe("when referencing an evaluation metric", () => {
      it("does not use SELECT * in the evaluation_runs subquery", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
            },
          ],
        });

        // The evaluation_runs subquery should use explicit columns
        expect(result.sql).not.toMatch(
          /SELECT\s+\*\s+FROM\s+evaluation_runs/,
        );
      });

      it("selects columns needed for JOIN key and referenced metric", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric:
                "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
            },
          ],
        });

        // Must have join key columns and the Score column
        expect(result.sql).toContain("TenantId");
        expect(result.sql).toContain("TraceId");
        expect(result.sql).toContain("Score");
      });
    });

    describe("when grouping by evaluations.evaluation_passed", () => {
      it("includes the Passed column", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
          groupBy: "evaluations.evaluation_passed",
          groupByKey: "test-evaluator",
        });

        expect(result.sql).toContain("Passed");
      });
    });
  });

  describe("stored spans JOIN column pruning", () => {
    describe("when grouping by metadata.span_type", () => {
      it("does not include wide span columns like Input and Output", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
          groupBy: "metadata.span_type",
        });

        expect(result.sql).not.toContain("ss.Input");
        expect(result.sql).not.toContain("ss.Output");
      });
    });

    describe("when grouping by events.event_type", () => {
      it("includes the Events.Name column", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
          groupBy: "events.event_type",
        });

        expect(result.sql).toContain("Events.Name");
      });
    });

    describe("when requesting performance.tokens_per_second", () => {
      it("includes DurationMs in the stored_spans subquery", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric:
                "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
            },
          ],
        });

        expect(result.sql).toContain("DurationMs");
      });
    });
  });

  describe("query correctness after pruning", () => {
    describe("when building a timeseries query for trace_count", () => {
      it("generates syntactically valid SQL", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        });

        // Basic SQL structure checks
        expect(result.sql).toContain("SELECT");
        expect(result.sql).toContain("FROM");
        expect(result.sql).toContain("WHERE");
        expect(result.sql).toContain("GROUP BY");
        // Should not have stray commas or empty column lists
        expect(result.sql).not.toMatch(/SELECT\s*,/);
        expect(result.sql).not.toMatch(/,\s*FROM/);
      });
    });

    describe("when building a CTE query for arrayJoin grouping", () => {
      it("selects only needed columns in the CTE inner query", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
          groupBy: "metadata.labels",
        });

        // CTE should have identity columns plus metric/group columns
        expect(result.sql).toContain("TraceId");
        expect(result.sql).toContain("period");
        expect(result.sql).toContain("group_key");
        // Should not have SELECT *
        expect(result.sql).not.toMatch(
          /SELECT\s+\*\s+FROM\s+trace_summaries/,
        );
      });
    });
  });

  describe("test guard: fieldMappings column coverage", () => {
    it("ensures all trace_summaries field mappings reference columns in the identity set or known metric/groupBy columns", () => {
      const traceSummaryMappings = Object.entries(fieldMappings).filter(
        ([_, mapping]) => mapping.table === "trace_summaries",
      );

      // Every column referenced by a trace_summaries field mapping must be
      // a column that analytics queries know about. This catches the case where
      // someone adds a new metric but forgets to add its column to the
      // pruned column list.
      const knownColumns = new Set([
        // Identity columns (always included)
        ...TRACE_IDENTITY_COLUMNS,
        // All columns referenced by trace_summaries mappings should be known
        "TenantId",
        "TraceId",
        "OccurredAt",
        "UpdatedAt",
        "CreatedAt",
        "TotalCost",
        "TotalDurationMs",
        "TimeToFirstTokenMs",
        "TotalPromptTokenCount",
        "TotalCompletionTokenCount",
        "TokensPerSecond",
        "ContainsErrorStatus",
        "ErrorMessage",
        "TopicId",
        "SubTopicId",
        "HasAnnotation",
        "Models",
        // Map column (used via Attributes['key'])
        "Attributes",
      ]);

      for (const [fieldName, mapping] of traceSummaryMappings) {
        // Extract the base column name (before any Map access)
        const baseColumn = mapping.column.split("[")[0]!;
        expect(
          knownColumns.has(baseColumn),
          `Field "${fieldName}" references column "${baseColumn}" which is not in the known analytics columns set. ` +
            `If you added a new metric, add its column to TRACE_IDENTITY_COLUMNS or the known columns in this test.`,
        ).toBe(true);
      }
    });

    it("ensures all stored_spans field mappings reference known span columns", () => {
      const spanMappings = Object.entries(fieldMappings).filter(
        ([_, mapping]) => mapping.table === "stored_spans",
      );

      const knownSpanColumns = new Set([
        "TenantId",
        "TraceId",
        "SpanId",
        "SpanAttributes",
        "StartTime",
        "EndTime",
        "DurationMs",
        "Events.Name",
        "Events.Timestamp",
        "Events.Attributes",
        "StatusCode",
      ]);

      for (const [fieldName, mapping] of spanMappings) {
        const baseColumn = mapping.column.split("[")[0]!;
        // Handle quoted column names like "Events.Name"
        const cleanColumn = baseColumn.replace(/"/g, "");
        expect(
          knownSpanColumns.has(cleanColumn),
          `Field "${fieldName}" references span column "${cleanColumn}" which is not in the known span columns set.`,
        ).toBe(true);
      }
    });

    it("ensures all evaluation_runs field mappings reference known evaluation columns", () => {
      const evalMappings = Object.entries(fieldMappings).filter(
        ([_, mapping]) => mapping.table === "evaluation_runs",
      );

      const knownEvalColumns = new Set([
        "TenantId",
        "TraceId",
        "EvaluationId",
        "EvaluatorId",
        "EvaluatorName",
        "EvaluatorType",
        "Score",
        "Passed",
        "Label",
        "Status",
        "IsGuardrail",
        "UpdatedAt",
      ]);

      for (const [fieldName, mapping] of evalMappings) {
        expect(
          knownEvalColumns.has(mapping.column),
          `Field "${fieldName}" references evaluation column "${mapping.column}" which is not in the known evaluation columns set.`,
        ).toBe(true);
      }
    });
  });
});
