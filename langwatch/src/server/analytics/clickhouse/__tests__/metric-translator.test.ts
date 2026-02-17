import { describe, expect, it } from "vitest";
import {
  buildMetricAlias,
  isPercentileAggregation,
  percentileToPercent,
  translateMetric,
  translatePipelineAggregation,
} from "../metric-translator";

describe("metric-translator", () => {
  describe("percentileToPercent", () => {
    it("maps percentile names to decimal values", () => {
      expect(percentileToPercent.median).toBe(0.5);
      expect(percentileToPercent.p90).toBe(0.9);
      expect(percentileToPercent.p95).toBe(0.95);
      expect(percentileToPercent.p99).toBe(0.99);
    });
  });

  describe("isPercentileAggregation", () => {
    it("identifies percentile aggregations", () => {
      expect(isPercentileAggregation("median")).toBe(true);
      expect(isPercentileAggregation("p90")).toBe(true);
      expect(isPercentileAggregation("p95")).toBe(true);
      expect(isPercentileAggregation("p99")).toBe(true);
    });

    it("rejects non-percentile aggregations", () => {
      expect(isPercentileAggregation("avg")).toBe(false);
      expect(isPercentileAggregation("sum")).toBe(false);
      expect(isPercentileAggregation("cardinality")).toBe(false);
    });
  });

  describe("buildMetricAlias", () => {
    it("builds basic alias with index, metric, and aggregation", () => {
      expect(buildMetricAlias(0, "performance.total_cost", "sum")).toBe(
        "0__performance_total_cost__sum"
      );
    });

    it("includes key in alias when provided", () => {
      expect(
        buildMetricAlias(1, "evaluations.evaluation_score", "avg", "eval-123")
      ).toBe("1__evaluations_evaluation_score__avg__eval_123");
    });

    it("includes both key and subkey in alias", () => {
      expect(
        buildMetricAlias(2, "events.event_score", "avg", "thumbs_up", "vote")
      ).toBe("2__events_event_score__avg__thumbs_up__vote");
    });

    it("sanitizes special characters in key and subkey", () => {
      expect(buildMetricAlias(0, "test", "avg", "key-with-dashes")).toBe(
        "0__test__avg__key_with_dashes"
      );
    });
  });

  describe("translateMetric", () => {
    describe("metadata metrics", () => {
      it("translates metadata.trace_id", () => {
        const result = translateMetric("metadata.trace_id", "cardinality", 0);
        expect(result.selectExpression).toContain("uniq(");
        expect(result.selectExpression).toContain("ts.TraceId");
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates metadata.user_id", () => {
        const result = translateMetric("metadata.user_id", "cardinality", 0);
        // Uses uniqIf to filter out empty user_ids to match ES behavior
        expect(result.selectExpression).toContain("uniqIf(");
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.user_id']"
        );
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates metadata.thread_id", () => {
        const result = translateMetric("metadata.thread_id", "cardinality", 0);
        // Uses uniqIf to filter out empty thread_ids to match ES behavior
        expect(result.selectExpression).toContain("uniqIf(");
        expect(result.selectExpression).toContain(
          "Attributes['gen_ai.conversation.id']"
        );
      });
    });

    describe("performance metrics", () => {
      it("translates performance.completion_time with avg", () => {
        const result = translateMetric("performance.completion_time", "avg", 0);
        expect(result.selectExpression).toContain("avg(");
        expect(result.selectExpression).toContain("TotalDurationMs");
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates performance.total_cost with sum", () => {
        const result = translateMetric("performance.total_cost", "sum", 0);
        expect(result.selectExpression).toContain("sum(");
        expect(result.selectExpression).toContain("TotalCost");
      });

      it("translates performance.first_token with p95", () => {
        const result = translateMetric("performance.first_token", "p95", 0);
        expect(result.selectExpression).toContain("quantileTDigest(0.95)");
        expect(result.selectExpression).toContain("TimeToFirstTokenMs");
      });

      it("translates performance.tokens_per_second using span-level calculation", () => {
        const result = translateMetric(
          "performance.tokens_per_second",
          "avg",
          0
        );
        // Calculates TPS at span level to match ES behavior
        // Uses canonical OTel attribute: gen_ai.usage.output_tokens
        expect(result.selectExpression).toContain("avgIf(");
        expect(result.selectExpression).toContain("gen_ai.usage.output_tokens");
        expect(result.selectExpression).toContain("DurationMs");
        expect(result.requiredJoins).toContain("stored_spans");
      });

      it("translates performance.total_tokens", () => {
        const result = translateMetric("performance.total_tokens", "sum", 0);
        expect(result.selectExpression).toContain("TotalPromptTokenCount");
        expect(result.selectExpression).toContain("TotalCompletionTokenCount");
      });
    });

    describe("evaluation metrics", () => {
      it("translates evaluations.evaluation_score and requires JOIN", () => {
        const result = translateMetric(
          "evaluations.evaluation_score",
          "avg",
          0
        );
        expect(result.selectExpression).toContain("es.Score");
        expect(result.selectExpression).toContain("Status = 'processed'");
        expect(result.requiredJoins).toContain("evaluation_states");
      });

      it("translates evaluations.evaluation_score with evaluator key using parameterized query", () => {
        const result = translateMetric(
          "evaluations.evaluation_score",
          "avg",
          0,
          "eval-123"
        );
        // Should use parameterized query for evaluator ID (SQL injection prevention)
        expect(result.selectExpression).toMatch(
          /es\.EvaluatorId = \{m_evaluatorId_[a-f0-9]+:String\}/
        );
        // Params should contain the evaluator ID value
        const paramKey = Object.keys(result.params).find((k) =>
          k.startsWith("m_evaluatorId_")
        );
        expect(paramKey).toBeDefined();
        expect(result.params[paramKey!]).toBe("eval-123");
      });

      it("translates evaluations.evaluation_pass_rate", () => {
        const result = translateMetric(
          "evaluations.evaluation_pass_rate",
          "avg",
          0
        );
        expect(result.selectExpression).toContain("es.Passed");
        expect(result.requiredJoins).toContain("evaluation_states");
      });

      it("translates evaluations.evaluation_runs", () => {
        const result = translateMetric(
          "evaluations.evaluation_runs",
          "cardinality",
          0
        );
        expect(result.selectExpression).toContain("uniqIf");
        expect(result.selectExpression).toContain("EvaluationId");
      });
    });

    describe("event metrics", () => {
      it("translates events.event_type and requires stored_spans JOIN", () => {
        const result = translateMetric("events.event_type", "cardinality", 0);
        expect(result.requiredJoins).toContain("stored_spans");
      });

      it("translates events.event_type with event type key using parameterized query", () => {
        const result = translateMetric(
          "events.event_type",
          "cardinality",
          0,
          "thumbs_up_down"
        );
        expect(result.selectExpression).toContain("countIf");
        // Should use parameterized query for event type (SQL injection prevention)
        expect(result.selectExpression).toMatch(
          /\{m_eventType_[a-f0-9]+:String\}/
        );
        // Params should contain the event type value
        const paramKey = Object.keys(result.params).find((k) =>
          k.startsWith("m_eventType_")
        );
        expect(paramKey).toBeDefined();
        expect(result.params[paramKey!]).toBe("thumbs_up_down");
      });
    });

    describe("sentiment metrics", () => {
      it("translates sentiment.input_sentiment", () => {
        const result = translateMetric("sentiment.input_sentiment", "avg", 0);
        expect(result.selectExpression).toContain(
          "langwatch.input.satisfaction_score"
        );
      });

      it("translates sentiment.thumbs_up_down", () => {
        const result = translateMetric("sentiment.thumbs_up_down", "sum", 0);
        expect(result.selectExpression).toContain("thumbs_up_down");
        expect(result.requiredJoins).toContain("stored_spans");
      });
    });

    describe("threads metrics", () => {
      it("translates threads.average_duration_per_thread with subquery", () => {
        const result = translateMetric(
          "threads.average_duration_per_thread",
          "avg",
          0
        );
        expect(result.requiresSubquery).toBe(true);
        expect(result.subquery).toBeDefined();
        expect(result.subquery?.innerSelect).toContain("thread_id");
        expect(result.subquery?.innerGroupBy).toBe("thread_id");
      });
    });

    describe("aggregation types", () => {
      it("uses uniq() for cardinality aggregation", () => {
        const result = translateMetric("metadata.trace_id", "cardinality", 0);
        expect(result.selectExpression).toContain("uniq(");
      });

      it("uses quantileTDigest for percentile aggregations", () => {
        const result = translateMetric("performance.completion_time", "p99", 0);
        expect(result.selectExpression).toContain("quantileTDigest(0.99)");
      });

      it("uses correct aggregation for min/max", () => {
        const minResult = translateMetric(
          "performance.completion_time",
          "min",
          0
        );
        expect(minResult.selectExpression).toContain("min(");

        const maxResult = translateMetric(
          "performance.completion_time",
          "max",
          1
        );
        expect(maxResult.selectExpression).toContain("max(");
      });
    });
  });

  describe("translatePipelineAggregation", () => {
    it("creates subquery for per-user aggregation", () => {
      const result = translatePipelineAggregation(
        "performance.total_cost",
        "sum",
        "user_id",
        "avg",
        0
      );
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery?.innerSelect).toContain(
        "Attributes['langwatch.user_id']"
      );
      expect(result.subquery?.innerGroupBy).toBe("pipeline_key");
      expect(result.subquery?.outerAggregation).toContain("avg(inner_value)");
    });

    it("creates subquery for per-thread aggregation", () => {
      const result = translatePipelineAggregation(
        "performance.completion_time",
        "avg",
        "thread_id",
        "sum",
        0
      );
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery?.innerSelect).toContain(
        "Attributes['gen_ai.conversation.id']"
      );
      expect(result.subquery?.outerAggregation).toContain("sum(inner_value)");
    });

    it("creates subquery for per-trace aggregation", () => {
      const result = translatePipelineAggregation(
        "performance.total_cost",
        "sum",
        "trace_id",
        "max",
        0
      );
      expect(result.subquery?.innerSelect).toContain("TraceId");
      expect(result.subquery?.outerAggregation).toContain("max(inner_value)");
    });

    it("inherits required JOINs from inner metric", () => {
      const result = translatePipelineAggregation(
        "evaluations.evaluation_score",
        "avg",
        "user_id",
        "avg",
        0,
        "eval-123"
      );
      expect(result.requiredJoins).toContain("evaluation_states");
    });

    it("handles threads.average_duration_per_thread with pipeline using nested subquery", () => {
      // threads.average_duration_per_thread with a pipeline requires 3-level aggregation:
      // 1. Group by (user_id, thread_id), compute thread duration
      // 2. Group by user_id, compute avg thread duration per user
      // 3. Compute avg across users
      const result = translatePipelineAggregation(
        "threads.average_duration_per_thread",
        "avg",
        "user_id",
        "avg",
        0
      );

      // Returns a subquery with nested structure
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery).toBeDefined();
      expect(result.subquery?.nestedSubquery).toBeDefined();
      expect(result.subquery?.nestedSubquery?.select).toContain("thread_duration");
      expect(result.subquery?.innerSelect).toContain("avg(thread_duration)");
      expect(result.selectExpression).toContain("avg(user_avg_duration)");
    });
  });
});
