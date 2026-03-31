import { beforeEach, describe, expect, it } from "vitest";
import { resetParamCounter } from "../filter-translator";
import {
  buildTimeseriesQuery,
  buildDataForFilterQuery,
  buildTopDocumentsQuery,
  buildFeedbacksQuery,
} from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";

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
      expect(result.sql).toContain("GROUP BY TenantId, TraceId");
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

      it("includes group_key in both sides of UNION ALL for simple metrics", () => {
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

        // Both the current and previous SELECT branches of UNION ALL must include group_key
        const unionParts = result.sql.split("UNION ALL");
        expect(unionParts.length).toBeGreaterThanOrEqual(2);
        expect(unionParts[0]).toContain("group_key");
        expect(unionParts[1]).toContain("group_key");
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

      it("includes group_key via FULL OUTER JOIN when mixing simple and subquery metrics", () => {
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

        expect(result.sql).toContain("group_key");
        expect(result.sql).toContain("FULL OUTER JOIN");
        expect(result.sql).toContain("UNION ALL");
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
});
