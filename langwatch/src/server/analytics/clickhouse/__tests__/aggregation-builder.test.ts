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

    it("should build a basic timeseries query", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("SELECT");
      expect(result.sql).toContain("FROM trace_summaries ts FINAL");
      expect(result.sql).toContain("WHERE");
      expect(result.sql).toContain("GROUP BY");
      expect(result.sql).toContain("period");
      expect(result.params.tenantId).toBe("test-project");
    });

    it("should include period case statement", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("CASE");
      expect(result.sql).toContain("'current'");
      expect(result.sql).toContain("'previous'");
    });

    it("should include date truncation for timescale", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("AS date");
      expect(result.sql).toContain("toStartOfInterval");
    });

    it("should handle 'full' timeScale without date grouping", () => {
      const input = { ...baseInput, timeScale: "full" as const };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).not.toContain("AS date");
    });

    it("should add metric expressions", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("TraceId");
    });

    it("should handle multiple metrics", () => {
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

    it("should add JOINs when metrics require them", () => {
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

      expect(result.sql).toContain("JOIN evaluation_states");
    });

    it("should add filters to WHERE clause with parameterized values", () => {
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

    it("should handle groupBy parameter", () => {
      const input = {
        ...baseInput,
        groupBy: "topics.topics",
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("AS group_key");
      expect(result.sql).toContain("ts.TopicId");
      expect(result.sql).toContain("GROUP BY period, date, group_key");
    });

    it("should add JOINs for groupBy that requires them", () => {
      const input = {
        ...baseInput,
        groupBy: "metadata.model",
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("JOIN stored_spans");
      expect(result.sql).toContain("gen_ai.request.model");
    });

    it("should include all date parameters", () => {
      const result = buildTimeseriesQuery(baseInput);

      expect(result.params.currentStart).toEqual(baseInput.startDate);
      expect(result.params.currentEnd).toEqual(baseInput.endDate);
      expect(result.params.previousStart).toEqual(
        baseInput.previousPeriodStartDate
      );
      expect(result.params.previousEnd).toEqual(baseInput.startDate);
    });

    it("should build CTE-based query for pipeline metrics with timeScale 'full'", () => {
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

      // Should use CTEs for pipeline metrics with cte_ prefix to avoid starting with digit
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("cte_0__metadata_thread_id__cardinality_current AS");
      expect(result.sql).toContain("cte_0__metadata_thread_id__cardinality_previous AS");
      expect(result.sql).toContain("UNION ALL");
      expect(result.sql).toContain("'current' AS period");
      expect(result.sql).toContain("'previous' AS period");
    });

    it("should include both simple and pipeline metrics in CTE query", () => {
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

      // Should have CTEs for both simple and pipeline metrics
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("simple_metrics_current AS");
      expect(result.sql).toContain("simple_metrics_previous AS");
      expect(result.sql).toContain("UNION ALL");
    });

    it("should use CTE query for simple metrics when timeScale is 'full' (no pipeline)", () => {
      const input = {
        ...baseInput,
        timeScale: "full" as const,
        series: [
          { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
          { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "sum" as const },
        ],
      };
      const result = buildTimeseriesQuery(input);

      // Should use CTE query even with only simple metrics
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("simple_metrics_current AS");
      expect(result.sql).toContain("simple_metrics_previous AS");
      expect(result.sql).toContain("UNION ALL");
      expect(result.sql).toContain("'current' AS period");
      expect(result.sql).toContain("'previous' AS period");

      // Column aliases starting with digits should be quoted with backticks
      expect(result.sql).toContain("`0__metadata_trace_id__cardinality`");
      expect(result.sql).toContain("`1__performance_total_cost__sum`");
    });

    it("should use standard query for pipeline metrics when timeScale is not 'full'", () => {
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

      // Should NOT use CTEs for non-full timeScale (filters out pipeline metrics)
      expect(result.sql).not.toContain("UNION ALL");
      expect(result.sql).toContain("GROUP BY period, date");
    });
  });

  describe("buildDataForFilterQuery", () => {
    const projectId = "test-project";
    const startDate = new Date("2024-01-01T00:00:00Z");
    const endDate = new Date("2024-01-02T00:00:00Z");

    it("should build query for topics.topics", () => {
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

    it("should build query for topics.subtopics", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "topics.subtopics",
        startDate,
        endDate
      );

      expect(result.sql).toContain("ts.SubTopicId AS field");
    });

    it("should build query for metadata.user_id", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "metadata.user_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("Attributes['langwatch.user_id']");
    });

    it("should build query for metadata.thread_id", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "metadata.thread_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("Attributes['gen_ai.conversation.id']");
    });

    it("should build query for spans.model with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "spans.model",
        startDate,
        endDate
      );

      expect(result.sql).toContain("JOIN stored_spans");
      expect(result.sql).toContain("gen_ai.request.model");
    });

    it("should build query for spans.type with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "spans.type",
        startDate,
        endDate
      );

      expect(result.sql).toContain("JOIN stored_spans");
      expect(result.sql).toContain("langwatch.span.type");
    });

    it("should build query for evaluations.evaluator_id with JOIN", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "evaluations.evaluator_id",
        startDate,
        endDate
      );

      expect(result.sql).toContain("JOIN evaluation_states");
      expect(result.sql).toContain("es.EvaluatorId AS field");
    });

    it("should filter guardrails only for evaluations.evaluator_id.guardrails_only", () => {
      const result = buildDataForFilterQuery(
        projectId,
        "evaluations.evaluator_id.guardrails_only",
        startDate,
        endDate
      );

      expect(result.sql).toContain("es.IsGuardrail = 1");
    });

    it("should build query for traces.error", () => {
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

    it("should add search query filter when provided", () => {
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

    it("should return empty result for unknown field", () => {
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

    it("should build query for top documents", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("documentId");
      expect(result.sql).toContain("count");
      expect(result.sql).toContain("traceId");
      expect(result.sql).toContain("content");
      expect(result.sql).toContain("langwatch.rag.contexts");
      expect(result.params.tenantId).toBe(projectId);
    });

    it("should include JOIN with stored_spans", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("JOIN stored_spans");
    });

    it("should include query for total unique documents", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      // Query has two parts separated by semicolon
      expect(result.sql).toContain(";");
      expect(result.sql).toContain("uniq(");
      expect(result.sql).toContain("AS total");
    });

    it("should include filters when provided", () => {
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

    it("should limit results to top 10", () => {
      const result = buildTopDocumentsQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("LIMIT 10");
    });
  });

  describe("buildFeedbacksQuery", () => {
    const projectId = "test-project";
    const startDate = new Date("2024-01-01T00:00:00Z");
    const endDate = new Date("2024-01-02T00:00:00Z");

    it("should build query for feedbacks", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("trace_id");
      expect(result.sql).toContain("event_id");
      expect(result.sql).toContain("started_at");
      expect(result.sql).toContain("event_type");
      expect(result.sql).toContain("attributes");
      expect(result.params.tenantId).toBe(projectId);
    });

    it("should filter for thumbs_up_down events", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("event_name = 'thumbs_up_down'");
    });

    it("should filter for events with feedback", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("mapContains(event_attrs, 'feedback')");
    });

    it("should include ARRAY JOIN for event arrays", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("ARRAY JOIN");
      expect(result.sql).toContain('Events.Timestamp"');
      expect(result.sql).toContain('Events.Name"');
      expect(result.sql).toContain('Events.Attributes"');
    });

    it("should include filters when provided with parameterized values", () => {
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

    it("should limit results to 100", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("LIMIT 100");
    });

    it("should order by timestamp descending", () => {
      const result = buildFeedbacksQuery(projectId, startDate, endDate);

      expect(result.sql).toContain("ORDER BY event_timestamp DESC");
    });
  });
});
