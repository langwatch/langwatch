import { describe, expect, it } from "vitest";
import {
  buildTimeseriesQuery,
  buildDataForFilterQuery,
  buildTopDocumentsQuery,
  buildFeedbacksQuery,
} from "../aggregation-builder";

describe("aggregation-builder", () => {
  describe("buildTimeseriesQuery", () => {
    const baseInput = {
      projectId: "test-project",
      startDate: new Date("2024-01-01T00:00:00Z"),
      endDate: new Date("2024-01-02T00:00:00Z"),
      previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
      series: [
        { metric: "metadata.trace_id", aggregation: "cardinality" as const },
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
          { metric: "metadata.trace_id", aggregation: "cardinality" as const },
          { metric: "performance.total_cost", aggregation: "sum" as const },
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
            metric: "evaluations.evaluation_score",
            aggregation: "avg" as const,
          },
        ],
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("JOIN evaluation_states");
    });

    it("should add filters to WHERE clause", () => {
      const input = {
        ...baseInput,
        filters: {
          "topics.topics": ["topic-1", "topic-2"],
        },
      };
      const result = buildTimeseriesQuery(input);

      expect(result.sql).toContain("ts.TopicId IN");
      expect(result.sql).toContain("'topic-1'");
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

    it("should include filters when provided", () => {
      const filters = {
        "metadata.user_id": ["user-1"],
      };
      const result = buildFeedbacksQuery(
        projectId,
        startDate,
        endDate,
        filters
      );

      expect(result.sql).toContain("langwatch.user_id");
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
