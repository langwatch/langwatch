import { beforeEach, describe, expect, it } from "vitest";
import { resetParamCounter } from "../filter-translator";
import {
  buildTimeseriesQuery,
  buildDataForFilterQuery,
  buildTopDocumentsQuery,
  buildFeedbacksQuery,
  __testOnly__,
} from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";

const {
  mapEvalAggregationToOuter,
  extractTraceAggregationColumn,
  hasEvalMixedWithTraceMetrics,
} = __testOnly__;

describe("aggregation-builder", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("buildTimeseriesQuery", () => {
    const baseInput = {
      projectId: "test-project",
      startDate: new Date("2024-01-01T00:00:00Z"),
      endDate: new Date("2024-01-02T00:00:00Z"),
      previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
      series: [
        { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
      ],
      timeScale: 60, // 1 hour
    };

    it("builds a basic timeseries query", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("SELECT");
      expect(result.sql).toContain("FROM trace_summaries");
      expect(result.sql).toContain("LIMIT 1 BY TenantId, TraceId");
      expect(result.sql).toContain("WHERE");
      expect(result.sql).toContain("GROUP BY");
      expect(result.sql).toContain("period");
      expect(result.params.tenantId).toBe("test-project");
    });

    it("includes period case statement", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("CASE");
      expect(result.sql).toContain("'current'");
      expect(result.sql).toContain("'previous'");
    });

    it("includes date truncation for timescale", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("AS date");
      expect(result.sql).toContain("toStartOfInterval");
    });

    it("handles 'full' timeScale without date grouping", () => {
      const input = { ...baseInput, timeScale: "full" as const };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).not.toContain("AS date");
    });

    it("adds metric expressions", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("TraceId");
    });

    it("handles multiple metrics", () => {
      const input = {
        ...baseInput,
        series: [
          { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
        ],
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("sum(");
      expect(result.sql).toContain("TotalCost");
    });

    // @regression: LLM Metrics card mixed metadata.span_type (cardinality) with
    // performance.total_cost (sum) and performance.total_tokens (sum). The span_type
    // metric forced a stored_spans JOIN even though cardinality only uses uniq(TraceId)
    // from trace_summaries. The JOIN created one row per span per trace, inflating
    // the trace-level SUM aggregations (cost ~4x, tokens ~6x).
    // @regression issue #3088: When trace-level metrics (sum of TotalCost) are combined
    // with evaluation metrics (avg of evaluation_pass_rate) in buildSimpleTimeseriesQuery,
    // the evaluation_runs JOIN produces N rows per trace, inflating sum(TotalCost) by N.
    // The fix must ensure trace-level aggregations are not fanned out by eval join cardinality.
    it("does not inflate trace-level aggregations when mixed with evaluation metrics in simple path", () => {
      const input = {
        ...baseInput,
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Assert the fix's specific SQL shape: a per-trace CTE exists with trace_id
      // in its GROUP BY, and the outer query aggregates over that CTE — not over
      // the raw evaluation_runs join.
      expect(result.sql).toMatch(/WITH\s+per_trace_metrics\s+AS\s*\(/);
      expect(result.sql).toMatch(/GROUP BY[^)]*\btrace_id\b/);
      expect(result.sql).not.toMatch(/\bsum\s*\(\s*ts\.TotalCost\s*\)/);

      // Both metrics must still be emitted by any valid fix.
      expect(result.sql).toContain("Passed");
      expect(result.sql).toContain("0__performance_total_cost__sum");
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
    });

    // @regression issue #3088: When timeScale is "full" (summary widgets) with mixed eval and
    // trace metrics, the previous routing fell through to buildSubqueryTimeseriesQuery which
    // still joined evaluation_runs directly and inflated sum(ts.TotalCost) by the number of
    // evaluation runs per trace.
    it("does not inflate trace metrics with mixed eval metrics when timeScale is full", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Must use per-trace CTE approach, not plain sum(ts.TotalCost) over fanned-out eval rows
      const hasRawTotalCostSum = /\bsum\s*\(\s*ts\.TotalCost\s*\)/.test(result.sql);
      expect(hasRawTotalCostSum).toBe(false);

      // Must contain the per-trace CTE (the fix uses a WITH clause that groups by trace_id)
      expect(result.sql).toMatch(/\bWITH\b/);
      expect(result.sql).toMatch(/GROUP BY\s+trace_id\b/);

      // Both aliases still present
      expect(result.sql).toContain("0__performance_total_cost__sum");
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
    });

    // @regression issue #3088: When metadata.user_id (cardinality, which uses
    // Attributes['langwatch.user_id']) was mixed with evaluation metrics,
    // extractTraceAggregationColumn returned null because its regex didn't handle
    // Attributes-indexed columns, and the defensive fallback produced invalid nested
    // any(uniqIf(...)) SQL.
    it("handles metadata.user_id mixed with evaluation metrics correctly", () => {
      const input = {
        ...baseInput,
        series: [
          { metric: "metadata.user_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Must not produce nested aggregations like any(uniqIf(...)) or any(avg(...))
      expect(result.sql).not.toMatch(/\bany\s*\(\s*\w+If\s*\(/);
      expect(result.sql).not.toMatch(/\bany\s*\(\s*(sum|avg|min|max|count|uniq)\s*\(/);

      // Both metric aliases still emitted
      expect(result.sql).toContain("0__metadata_user_id__cardinality");
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
    });

    // @regression issue #3088: When trace-level metrics (sum TotalCost) are combined with
    // evaluation metrics (avg evaluation_pass_rate) while using a groupBy that activates
    // the CTE/arrayJoin path (metadata.labels), the outer SELECT previously referenced
    // `es.Passed` outside the CTE where the `es` alias no longer exists. Trace-level
    // metrics would also be double-counted via the eval JOIN fanout.
    it("produces valid SQL when mixing trace and evaluation metrics with arrayJoin groupBy", () => {
      const input = {
        ...baseInput,
        groupBy: "metadata.labels",
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // The query must still group by the label arrayJoin
      expect(result.sql).toContain("arrayJoin");

      // The trace-level metric must be transformed to use the CTE column
      expect(result.sql).toContain("trace_total_cost");

      // The outer query must reference a pre-aggregated eval value, not es.Passed directly.
      // With the fix, the per-trace alias pattern is present (the eval metric is
      // pre-aggregated inside the CTE) and the outer aggregation is a plain avg over that
      // per-trace column, not an avgIf conditional aggregation.
      expect(result.sql).toMatch(/_per_trace/);
      expect(result.sql).toMatch(
        /\bavg\s*\(\s*`?1__evaluations_evaluation_pass_rate__avg__my_evaluator__per_trace`?\s*\)/,
      );

      // The eval metric alias must still be emitted
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
    });

    // @regression: Pie charts with arrayJoin groupBy (e.g. metadata.labels) add a
    // pipeline { field: "trace_id", aggregation: "sum" } which sets requiresSubquery.
    // buildArrayJoinTimeseriesQuery previously dropped all subquery metrics, returning
    // empty data. The fix re-translates trace_id pipeline metrics as simple metrics
    // since the CTE already deduplicates by (trace_id, group_key).
    it("includes pipeline metrics with trace_id field in arrayJoin groupBy path", () => {
      const input = {
        ...baseInput,
        groupBy: "metadata.labels" as const,
        series: [
          {
            metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "trace_id" as const, aggregation: "sum" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Must route through the arrayJoin CTE path
      expect(result.sql).toContain("arrayJoin");
      expect(result.sql).toContain("deduped_traces");

      // The metric alias must be present in the outer SELECT (not silently dropped)
      expect(result.sql).toContain("0__metadata_trace_id__cardinality");

      // The metric should be converted to uniqExact(trace_id) via transformMetricForDedup
      expect(result.sql).toContain("uniqExact(trace_id)");
    });

    // Verify that page-level filters are applied inside the arrayJoin CTE
    // when combined with pipeline metrics and groupBy labels.
    it("applies label filters in arrayJoin groupBy path with pipeline metrics", () => {
      const input = {
        ...baseInput,
        groupBy: "metadata.labels" as const,
        filters: {
          "metadata.labels": ["populator", "conversation"],
        },
        series: [
          {
            metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "trace_id" as const, aggregation: "sum" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Must route through arrayJoin CTE path
      expect(result.sql).toContain("deduped_traces");

      // Filter must be in the CTE WHERE clause
      expect(result.sql).toContain("hasAny");
      expect(result.sql).toContain("langwatch.labels");

      // Filter params must be present
      const paramKeys = Object.keys(result.params);
      const labelsParam = paramKeys.find((k) => k.startsWith("labels"));
      expect(labelsParam).toBeDefined();
      expect(result.params[labelsParam!]).toEqual(["populator", "conversation"]);
    });

    it("does not JOIN stored_spans when metadata.span_type uses cardinality alongside trace-level metrics", () => {
      const input = {
        ...baseInput,
        series: [
          { metric: "metadata.span_type" as FlattenAnalyticsMetricsEnum, key: "llm", aggregation: "cardinality" as const },
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "performance.total_tokens" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // The query must NOT join stored_spans — all three metrics work from trace_summaries alone
      expect(result.sql).not.toContain("JOIN stored_spans");
      expect(result.sql).not.toContain("FROM stored_spans");
      // But the metrics themselves should still be present
      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("TotalCost");
      expect(result.sql).toContain("TotalPromptTokenCount");
    });

    it("adds JOINs when metrics require them", () => {
      const input = {
        ...baseInput,
        series: [
          {
            metric: "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as const,
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("FROM evaluation_runs");
      expect(result.sql).toContain("GROUP BY TenantId, EvaluationId");
    });

    it("adds filters to WHERE clause with parameterized values", () => {
      const input = {
        ...baseInput,
        filters: {
          "topics.topics": ["topic-1", "topic-2"],
        },
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("ts.TopicId IN");
      expect(result.sql).toContain("{topicIds_0:Array(String)}");
      expect(result.params).toHaveProperty("topicIds_0", ["topic-1", "topic-2"]);
    });

    it("handles groupBy parameter", () => {
      const input = {
        ...baseInput,
        groupBy: "topics.topics",
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("AS group_key");
      expect(result.sql).toContain("ts.TopicId");
      expect(result.sql).toContain("GROUP BY period, date, group_key");
    });

    it("uses trace-level Models array for model grouping", () => {
      const input = {
        ...baseInput,
        groupBy: "metadata.model",
      };
      const result = buildTimeseriesQuery(input);

      // Model grouping uses trace_summaries.Models (array) via arrayJoin
      // instead of stored_spans to avoid double-counting trace metrics
      expect(result.sql).not.toContain("JOIN stored_spans");
      expect(result.sql).toContain("Models");
      expect(result.sql).toContain("arrayJoin");
    });

    it("includes all date parameters", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.params.currentStart).toEqual(baseInput.startDate);
      expect(result.params.currentEnd).toEqual(baseInput.endDate);
      expect(result.params.previousStart).toEqual(
        baseInput.previousPeriodStartDate
      );
      expect(result.params.previousEnd).toEqual(baseInput.startDate);
    });

    it("builds CTE-based query for pipeline metrics with timeScale 'full'", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          {
            metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Uses CTEs for pipeline metrics with cte_ prefix to avoid starting with digit
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("cte_0__metadata_thread_id__cardinality_current AS");
      expect(result.sql).toContain("cte_0__metadata_thread_id__cardinality_previous AS");
      expect(result.sql).toContain("UNION ALL");
      expect(result.sql).toContain("'current' AS period");
      expect(result.sql).toContain("'previous' AS period");
    });

    it("includes both simple and pipeline metrics in CTE query", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          {
            metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Has CTEs for both simple and pipeline metrics
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("simple_metrics_current AS");
      expect(result.sql).toContain("simple_metrics_previous AS");
      expect(result.sql).toContain("UNION ALL");
    });

    it("uses CTE query for simple metrics when timeScale is 'full' (no pipeline)", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Uses CTE query even with only simple metrics
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("simple_metrics_current AS");
      expect(result.sql).toContain("simple_metrics_previous AS");
      expect(result.sql).toContain("UNION ALL");
      expect(result.sql).toContain("'current' AS period");
      expect(result.sql).toContain("'previous' AS period");

      // Column aliases starting with digits are quoted with backticks
      expect(result.sql).toContain("`0__metadata_trace_id__cardinality`");
      expect(result.sql).toContain("`1__performance_total_cost__sum`");
    });

    describe("when timeScale is full with groupBy", () => {
      // @regression issue #2644: Summary charts with groupBy render blank because
      // buildSubqueryTimeseriesQuery never includes group_key in SELECT, GROUP BY,
      // or UNION ALL — causing the frontend to receive no group dimension to render.

      it("includes group_key in the UNION ALL SELECT for simple metrics", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_label" as const,
          groupByKey: "my-evaluator",
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        expect(result.sql).toContain("group_key");
      });

      it("includes group_key in the CTE query for pipeline metrics", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_label" as const,
          groupByKey: "my-evaluator",
          series: [
            {
              metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
              pipeline: { field: "user_id" as const, aggregation: "avg" as const },
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        expect(result.sql).toContain("group_key");
      });

      it("includes group_key in standard query for simple metrics with groupBy", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_label" as const,
          groupByKey: "my-evaluator",
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // timeScale "full" + groupBy uses the standard query path (not CTE/UNION ALL),
        // which produces a single SELECT with GROUP BY period, group_key
        expect(result.sql).toContain("group_key");
        expect(result.sql).toContain("GROUP BY");
        expect(result.sql).toContain("period");
      });

      it("does not include group_key when groupBy is absent", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        expect(result.sql).not.toContain("group_key");
      });

      it("includes group_key when mixing simple and pipeline metrics with groupBy", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_label" as const,
          groupByKey: "my-evaluator",
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
            {
              metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
              pipeline: { field: "user_id" as const, aggregation: "avg" as const },
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // timeScale "full" + groupBy falls through to the standard query path,
        // which includes group_key in a single SELECT with GROUP BY
        expect(result.sql).toContain("group_key");
        expect(result.sql).toContain("GROUP BY");
      });

      it("uses direct group_key alias without null-check wrapper when groupBy handlesUnknown", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "evaluations.evaluation_passed" as const,
          groupByKey: "my-evaluator",
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        expect(result.sql).toContain("group_key");
        // When handlesUnknown=true the column expression itself handles unknown values,
        // so no outer if(... IS NULL, 'unknown', toString(...)) wrapper is added.
        expect(result.sql).not.toContain("IS NULL, 'unknown'");
      });
    });

    it("uses date-bucketed pipeline query for pipeline metrics with numeric timeScale", () => {
      const input = {
        ...baseInput,
        timeScale: 60,
        series: [
          {
            metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("pipeline_key");
      expect(result.sql).toContain("inner_value");
      expect(result.sql).toContain("AS period");
      expect(result.sql).toContain("AS date");
      expect(result.sql).toContain("avg(inner_value)");
      expect(result.sql).toContain("GROUP BY");
      expect(result.params.tenantId).toBe("test-project");
      expect(result.sql).toContain("TenantId = {tenantId:String}");
    });

    it("builds date-bucketed pipeline query with evaluation groupBy", () => {
      const input = {
        ...baseInput,
        timeScale: 1440,
        series: [
          {
            metric: "evaluations.evaluation_runs" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "trace_id" as const, aggregation: "sum" as const },
          },
        ],
        groupBy: "evaluations.evaluation_passed",
        groupByKey: "my-evaluator",
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("pipeline_key");
      expect(result.sql).toContain("group_key");
      expect(result.sql).toContain("AS date");
      expect(result.sql).toContain("AS period");
      expect(result.sql).toContain("sum(inner_value)");
      expect(result.params.tenantId).toBe("test-project");
      expect(result.params).toHaveProperty("groupByKey", "my-evaluator");
      expect(result.sql).toContain("TenantId = {tenantId:String}");
    });

    it("builds date-bucketed pipeline query for nested subquery metrics", () => {
      const input = {
        ...baseInput,
        timeScale: 60,
        series: [
          {
            metric: "threads.average_duration_per_thread" as FlattenAnalyticsMetricsEnum,
            aggregation: "avg" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("thread_duration");
      expect(result.sql).toContain("pipeline_key");
      expect(result.sql).toContain("AS date");
      expect(result.sql).toContain("AS period");
      expect(result.params.tenantId).toBe("test-project");
      expect(result.sql).toContain("TenantId = {tenantId:String}");
    });

    it("enforces tenant isolation in date-bucketed pipeline queries", () => {
      const input = {
        ...baseInput,
        timeScale: 1440,
        series: [
          {
            metric: "evaluations.evaluation_runs" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "trace_id" as const, aggregation: "sum" as const },
          },
        ],
        groupBy: "evaluations.evaluation_passed",
        groupByKey: "my-evaluator",
      };
      const result = buildTimeseriesQuery(input);

      // Tenant isolation in params
      expect(result.params.tenantId).toBe("test-project");
      // Tenant isolation in SQL (dedupedTraceSummaries + baseWhere)
      expect(result.sql).toContain("TenantId = {tenantId:String}");
    });

    describe("when groupBy is evaluation field with cross-evaluator metrics", () => {
      // @regression issue #2668: groupByAdditionalWhere was appended to the global WHERE
      // clause, pre-filtering the entire dataset to one evaluator. This caused metrics
      // that use conditional aggregation (avgIf/sumIf with their OWN evaluator filter)
      // to find no matching rows because the global WHERE already excluded all rows for
      // the OTHER evaluator.

      it("excludes global EvaluatorId WHERE filter for evaluation_label groupBy", () => {
        // GroupBy evaluatorA, but metric targets evaluatorB via its own conditional aggregation.
        // The global WHERE must NOT filter by evaluatorA — that would make evaluatorB rows invisible.
        const input = {
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          groupByKey: "evaluatorA",
          series: [
            {
              metric: "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
              key: "evaluatorB",
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // The group_key expression should incorporate the evaluatorA filter (not the global WHERE)
        expect(result.sql).toContain("group_key");
        // The metric's conditional aggregation should reference evaluatorB
        expect(result.sql).toContain("evaluatorB");
        // The global WHERE clause must NOT contain a standalone EvaluatorId equality filter
        // (it would appear as "AND es.EvaluatorId = {groupByKey:String}" or similar)
        const whereSection = result.sql.split("GROUP BY")[0] ?? result.sql;
        expect(whereSection).not.toMatch(
          /AND\s+es\.EvaluatorId\s*=\s*\{groupByKey:String\}/,
        );
      });

      it("excludes global EvaluatorId WHERE filter for evaluation_passed groupBy", () => {
        const input = {
          ...baseInput,
          groupBy: "evaluations.evaluation_passed",
          groupByKey: "evaluatorA",
          series: [
            {
              metric: "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
              key: "evaluatorB",
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        expect(result.sql).toContain("group_key");
        expect(result.sql).toContain("evaluatorB");
        const whereSection = result.sql.split("GROUP BY")[0] ?? result.sql;
        expect(whereSection).not.toMatch(
          /AND\s+es\.EvaluatorId\s*=\s*\{groupByKey:String\}/,
        );
      });

      it("keeps EvaluatorId condition inside group_key expression for evaluation_label", () => {
        const input = {
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          groupByKey: "evaluatorA",
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality" as const,
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // The evaluator filter must live inside the group_key column expression, not in WHERE
        expect(result.sql).toContain("{groupByKey:String}");
        // The group_key expression should be conditional (if/CASE) so non-matching rows
        // return NULL and get filtered by HAVING rather than excluded from the whole dataset
        expect(result.sql).toMatch(/if\(.*EvaluatorId.*group_key|CASE.*EvaluatorId/s);
        const whereSection = result.sql.split("GROUP BY")[0] ?? result.sql;
        expect(whereSection).not.toMatch(
          /AND\s+es\.EvaluatorId\s*=\s*\{groupByKey:String\}/,
        );
      });

      it("produces no evaluator filter when groupByKey is absent", () => {
        const input = {
          ...baseInput,
          groupBy: "evaluations.evaluation_label",
          // no groupByKey
          series: [
            {
              metric: "evaluations.evaluation_score" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
              key: "evaluatorB",
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // Without a groupByKey there is no evaluator groupBy filter at all
        expect(result.sql).not.toContain("{groupByKey:String}");
        expect(result.params).not.toHaveProperty("groupByKey");
      });
    });

    describe("when evaluation pass rate metric is combined with labels groupBy", () => {
      // @regression issue #3067: evaluation metrics reference `es.Passed` which is
      // out of scope in the CTE outer SELECT. The fix includes eval columns in the
      // CTE and rewrites `es.X` → `eval_snake_case` in the outer query.
      it("rewrites es.Passed and es.Status to CTE column aliases", () => {
        const input = {
          ...baseInput,
          timeScale: "full" as const,
          groupBy: "metadata.labels" as const,
          series: [
            {
              metric:
                "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum,
              aggregation: "avg" as const,
              key: "some-evaluator",
            },
          ],
        };
        const result = buildTimeseriesQuery(input);

        // CTE must include evaluation columns with eval_ prefix
        expect(result.sql).toContain("AS eval_passed");
        expect(result.sql).toContain("AS eval_status");
        expect(result.sql).toContain("AS eval_evaluator_id");

        // Outer SELECT (after the CTE) must use eval_ aliases, not es.X
        const outerSelect = result.sql.split("FROM deduped_traces")[0]!
          .split(")\n    SELECT")[1]!;
        expect(outerSelect).toContain("eval_passed");
        expect(outerSelect).toContain("eval_status");
        expect(outerSelect).toContain("eval_evaluator_id");
        expect(outerSelect).not.toContain("es.");
      });
    });

    // @regression: Pipeline metrics must not be dropped when hasEvalMixedWithTraceMetrics fires.
    // Before the guard, buildMixedEvalTimeseriesQuery only received simpleMetrics,
    // so pipeline series (requiresSubquery=true) vanished from the output.
    it("preserves pipeline metrics when mixed with trace and eval simple metrics", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
          {
            metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // All three metric aliases must be present
      expect(result.sql).toContain("0__performance_total_cost__sum");
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
      expect(result.sql).toContain("2__metadata_thread_id__cardinality");
    });

    // @regression: buildDateBucketedPipelineQuery previously only received pipeline
    // metrics, silently dropping simple metrics when mixed with pipeline metrics
    // on numeric timeScale.
    it("preserves simple metrics alongside pipeline metrics with numeric timeScale", () => {
      const input = {
        ...baseInput,
        timeScale: 60,
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          {
            metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
            aggregation: "cardinality" as const,
            pipeline: { field: "user_id" as const, aggregation: "avg" as const },
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Both metric aliases must be present
      expect(result.sql).toContain("0__performance_total_cost__sum");
      expect(result.sql).toContain("1__metadata_thread_id__cardinality");

      // Simple metrics should be in a simple_metrics CTE
      expect(result.sql).toContain("simple_metrics");
    });

    // @regression: count-like trace metrics (count(), uniq(TraceId)) mixed with eval
    // metrics previously threw because extractTraceAggregationColumn returned null for
    // expressions without a table.column reference.
    it("handles count() trace metric mixed with evaluation metrics", () => {
      const input = {
        ...baseInput,
        series: [
          { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      // Should NOT throw — count-like metrics must be handled explicitly
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("0__metadata_trace_id__cardinality");
      expect(result.sql).toContain("1__evaluations_evaluation_pass_rate__avg");
      // The per-trace CTE should exist
      expect(result.sql).toMatch(/WITH\s+per_trace_metrics/);
    });

    // @regression: timeScale "full" without groupBy must guarantee both 'current' and
    // 'previous' period rows even when one period has no data. The UNION ALL approach
    // with per-period CTEs ensures this.
    it("guarantees both period rows for timeScale full with mixed eval and trace metrics", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
          { metric: "evaluations.evaluation_pass_rate" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const, key: "my-evaluator" },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Must use UNION ALL to guarantee both periods
      expect(result.sql).toContain("UNION ALL");
      expect(result.sql).toContain("'current' AS period");
      expect(result.sql).toContain("'previous' AS period");

      // Must use per-period CTEs
      expect(result.sql).toContain("per_trace_metrics_current");
      expect(result.sql).toContain("per_trace_metrics_previous");
    });
  });

  describe("buildDataForFilterQuery", () => {
    const projectId = "test-project";
    const startDate = new Date("2024-01-01T00:00:00Z");
    const endDate = new Date("2024-01-02T00:00:00Z");

    it("builds query for topics.topics", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "topics.topics",
        startDate,
        endDate
      );

      expect(result.sql).toContain("ts.TopicId AS field");
      expect(result.sql).toContain("count() AS count");
      expect(result.sql).toContain("GROUP BY");
      expect(result.sql).toContain("ORDER BY count DESC");
      expect(result.params.tenantId).toBe(projectId);
    });

    it("builds query for topics.subtopics", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "topics.subtopics",
        startDate,
        endDate
      );

      expect(result.sql).toContain("ts.SubTopicId AS field");
    });

    it("builds query for metadata.user_id", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "metadata.user_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("Attributes['langwatch.user_id']");
    });

    it("builds query for metadata.thread_id", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "metadata.thread_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("Attributes['gen_ai.conversation.id']");
    });

    it("builds query for spans.model with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "spans.model",
        startDate,
        endDate
      );

      expect(result.sql).toContain("FROM stored_spans");
      expect(result.sql).toContain("gen_ai.request.model");
    });

    it("builds query for spans.type with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "spans.type",
        startDate,
        endDate
      );

      expect(result.sql).toContain("FROM stored_spans");
      expect(result.sql).toContain("langwatch.span.type");
    });

    it("builds query for evaluations.evaluator_id with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "evaluations.evaluator_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("FROM evaluation_runs");
      expect(result.sql).toContain("GROUP BY TenantId, EvaluationId");
      expect(result.sql).toContain("es.EvaluatorId AS field");
    });

    it("filters guardrails only for evaluations.evaluator_id.guardrails_only", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "evaluations.evaluator_id.guardrails_only",
        startDate,
        endDate
      );

      expect(result.sql).toContain("es.IsGuardrail = 1");
    });

    it("builds query for traces.error", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "traces.error",
        startDate,
        endDate
      );

      expect(result.sql).toContain("ContainsErrorStatus");
      expect(result.sql).toContain("'Traces with error'");
      expect(result.sql).toContain("'Traces without error'");
    });

    it("adds search query filter when provided", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "topics.topics",
        startDate,
        endDate,
        undefined,
        undefined,
        "search-term"
      );

      expect(result.sql).toContain("ILIKE");
      expect(result.params.searchQuery).toBe("%search-term%");
    });

    it("returns empty result for unknown field", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "unknown.field" as any,
        startDate,
        endDate
      );

      expect(result.sql).toContain("WHERE 1=0");
    });
  });

  describe("buildTopDocumentsQuery", () => {
    const projectId = "test-project";
    const startDate = new Date("2024-01-01T00:00:00Z");
    const endDate = new Date("2024-01-02T00:00:00Z");

    it("builds query for top documents", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("documentId");
      expect(result.sql).toContain("count");
      expect(result.sql).toContain("traceId");
      expect(result.sql).toContain("content");
      expect(result.sql).toContain("langwatch.rag.contexts");
      expect(result.params.tenantId).toBe(projectId);
    });

    it("includes JOIN with stored_spans", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("JOIN stored_spans");
    });

    it("includes query for total unique documents", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      // Query has two parts separated by semicolon
      expect(result.sql).toContain(";");
      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("AS total");
    });

    it("includes filters when provided", () => {
      const filters = {
        "topics.topics": ["topic-1"],
      };
      const result = buildTopDocumentsQuery(
        projectId,
        startDate,
        endDate,
        filters
      );

      expect(result.sql).toContain("ts.TopicId IN");
    });

    it("limits results to top 10", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("LIMIT 10");
    });
  });

  describe("buildFeedbacksQuery", () => {
    const projectId = "test-project";
    const startDate = new Date("2024-01-01T00:00:00Z");
    const endDate = new Date("2024-01-02T00:00:00Z");

    it("builds query for feedbacks", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("trace_id");
      expect(result.sql).toContain("event_id");
      expect(result.sql).toContain("started_at");
      expect(result.sql).toContain("event_type");
      expect(result.sql).toContain("attributes");
      expect(result.params.tenantId).toBe(projectId);
    });

    it("filters for thumbs_up_down events", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("event_name = 'thumbs_up_down'");
    });

    it("filters for thumbs_up_down events with vote metric", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("mapContains(event_attrs, 'event.metrics.vote')");
    });

    it("includes ARRAY JOIN for event arrays", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("ARRAY JOIN");
      expect(result.sql).toContain('Events.Timestamp"');
      expect(result.sql).toContain('Events.Name"');
      expect(result.sql).toContain('Events.Attributes"');
    });

    it("includes filters when provided with parameterized values", () => {
      const filters = {
        "metadata.user_id": ["user-1"],
      };
      const result = buildFeedbacksQuery(
        projectId,
        startDate,
        endDate,
        filters
      );

      // Filter values are now parameterized, key is in params
      expect(result.sql).toContain("ts.Attributes[{metaValues_");
      expect(result.params).toHaveProperty("metaValues_0_key", "langwatch.user_id");
      expect(result.params).toHaveProperty("metaValues_0", ["user-1"]);
    });

    it("limits results to 100", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("LIMIT 100");
    });

    it("orders by timestamp descending", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("ORDER BY event_timestamp DESC");
    });
  });

  describe("mapEvalAggregationToOuter", () => {
    const cases: Array<{ expression: string; expected: string }> = [
      { expression: "avgIf(toFloat64(es.Passed), cond)", expected: "avg" },
      { expression: "sumIf(es.Score, cond)", expected: "sum" },
      { expression: "minIf(es.Score, cond)", expected: "min" },
      { expression: "maxIf(es.Score, cond)", expected: "max" },
      // uniqIf -> sum: per-trace count of unique evaluation runs, safe to
      // sum across traces because EvaluationId is unique per trace.
      { expression: "uniqIf(es.EvaluationId, cond)", expected: "sum" },
      { expression: "countIf(es.Score, cond)", expected: "sum" },
      // quantileExactIf collapses to avg — an approximation that preserves
      // monotonic ordering of the metric across periods.
      { expression: "quantileExactIf(0.5)(es.Score, cond)", expected: "avg" },
    ];

    for (const { expression, expected } of cases) {
      const name = expression.split("(")[0];
      it(`maps ${name} to ${expected}`, () => {
        expect(mapEvalAggregationToOuter(expression)).toBe(expected);
      });
    }

    it("returns null for unknown aggregation patterns", () => {
      expect(mapEvalAggregationToOuter("stddevIf(es.Score, cond)")).toBeNull();
    });
  });

  describe("extractTraceAggregationColumn", () => {
    it("returns null for expressions that do not contain a column reference", () => {
      // No `<alias>.<column>` shape at all — should not match anything.
      expect(extractTraceAggregationColumn("some_udf(42)")).toBeNull();
    });

    it("handles bracketed Attributes columns", () => {
      expect(
        extractTraceAggregationColumn(
          "uniqIf(ts.Attributes['langwatch.user_id'], ts.Attributes['langwatch.user_id'] != '')",
        ),
      ).toBe("ts.Attributes['langwatch.user_id']");
    });

    it("handles dot-access columns wrapped in coalesce+sum", () => {
      expect(
        extractTraceAggregationColumn("coalesce(sum(ts.TotalCost), 0)"),
      ).toBe("ts.TotalCost");
    });
  });

  describe("hasEvalMixedWithTraceMetrics", () => {
    // Minimal MetricTranslation-shaped fixtures — the helper only inspects
    // `requiredJoins`, so other fields are intentionally stub values.
    type MetricStub = Parameters<typeof hasEvalMixedWithTraceMetrics>[0][number];
    const evalMetric = {
      selectExpression: "avgIf(es.Passed, 1)",
      alias: "e",
      requiredJoins: ["evaluation_runs"],
      params: {},
    } as unknown as MetricStub;
    const traceMetric = {
      selectExpression: "sum(ts.TotalCost)",
      alias: "t",
      requiredJoins: [],
      params: {},
    } as unknown as MetricStub;

    it("returns true when both eval and trace metrics are present", () => {
      expect(hasEvalMixedWithTraceMetrics([evalMetric, traceMetric])).toBe(
        true,
      );
    });

    it("returns false when only eval metrics are present", () => {
      expect(hasEvalMixedWithTraceMetrics([evalMetric])).toBe(false);
    });

    it("returns false when only trace metrics are present", () => {
      expect(hasEvalMixedWithTraceMetrics([traceMetric])).toBe(false);
    });

    it("returns false for an empty list", () => {
      expect(hasEvalMixedWithTraceMetrics([])).toBe(false);
    });
  });
});
