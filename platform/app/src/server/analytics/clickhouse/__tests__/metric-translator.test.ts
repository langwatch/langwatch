import { beforeEach, describe, expect, it } from "vitest";
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
      expect(
        buildMetricAlias({
          index: 0,
          metric: "performance.total_cost",
          aggregation: "sum",
        }),
      ).toBe("0__performance_total_cost__sum");
    });

    it("includes key in alias when provided", () => {
      expect(
        buildMetricAlias({
          index: 1,
          metric: "evaluations.evaluation_score",
          aggregation: "avg",
          key: "eval-123",
        }),
      ).toBe("1__evaluations_evaluation_score__avg__eval_123");
    });

    it("includes both key and subkey in alias", () => {
      expect(
        buildMetricAlias({
          index: 2,
          metric: "events.event_score",
          aggregation: "avg",
          key: "thumbs_up",
          subkey: "vote",
        }),
      ).toBe("2__events_event_score__avg__thumbs_up__vote");
    });

    it("sanitizes special characters in key and subkey", () => {
      expect(
        buildMetricAlias({
          index: 0,
          metric: "test",
          aggregation: "avg",
          key: "key-with-dashes",
        }),
      ).toBe("0__test__avg__key_with_dashes");
    });
  });

  describe("translateMetric", () => {
    describe("metadata metrics", () => {
      it("translates metadata.trace_id", () => {
        const result = translateMetric({
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          index: 0,
        });
        expect(result.selectExpression).toContain("uniq(");
        expect(result.selectExpression).toContain("ts.TraceId");
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates metadata.user_id", () => {
        const result = translateMetric({
          metric: "metadata.user_id",
          aggregation: "cardinality",
          index: 0,
        });
        // Uses uniqIf to filter out empty user_ids to match ES behavior
        expect(result.selectExpression).toContain("uniqIf(");
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.user_id']",
        );
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates metadata.thread_id", () => {
        const result = translateMetric({
          metric: "metadata.thread_id",
          aggregation: "cardinality",
          index: 0,
        });
        // Uses uniqIf to filter out empty thread_ids to match ES behavior
        expect(result.selectExpression).toContain("uniqIf(");
        expect(result.selectExpression).toContain(
          "Attributes['gen_ai.conversation.id']",
        );
      });

      describe("metadata.span_type", () => {
        // @regression: metadata.span_type with cardinality aggregation translates to
        // uniq(ts.TraceId) which only uses trace_summaries. The stored_spans JOIN was
        // incorrectly required, causing fan-out that inflated trace-level SUM metrics
        // (TotalCost, TotalTokens) when combined in the same query.
        it("does not require stored_spans JOIN for cardinality aggregation", () => {
          const result = translateMetric({
            metric: "metadata.span_type",
            aggregation: "cardinality",
            index: 0,
          });
          expect(result.selectExpression).toContain("uniq(");
          expect(result.selectExpression).toContain("ts.TraceId");
          expect(result.requiredJoins).not.toContain("stored_spans");
        });

        it("requires stored_spans JOIN for non-cardinality aggregations", () => {
          const result = translateMetric({
            metric: "metadata.span_type",
            aggregation: "terms",
            index: 0,
          });
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });
    });

    describe("performance metrics", () => {
      it("translates performance.completion_time with avg", () => {
        const result = translateMetric({
          metric: "performance.completion_time",
          aggregation: "avg",
          index: 0,
        });
        expect(result.selectExpression).toContain("avg(");
        expect(result.selectExpression).toContain("TotalDurationMs");
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates performance.total_cost with sum", () => {
        const result = translateMetric({
          metric: "performance.total_cost",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain("sum(");
        expect(result.selectExpression).toContain("TotalCost");
      });

      it("translates performance.cost_billed to TotalCost minus the bundled portion", () => {
        const result = translateMetric({
          metric: "performance.cost_billed",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain("sum(");
        // billed = grand total minus the folded non-billed amount.
        expect(result.selectExpression).toContain(
          "coalesce(ts.TotalCost, 0) -",
        );
        // the non-billed amount prefers the folded column ...
        expect(result.selectExpression).toContain("ts.NonBilledCost");
        // ... falling back to the legacy boolean for pre-column rows.
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.cost.non_billable'] = 'true'",
        );
      });

      it("translates performance.cost_non_billed to the folded bundled amount with legacy fallback", () => {
        const result = translateMetric({
          metric: "performance.cost_non_billed",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain("sum(");
        // prefers the fold-time column ...
        expect(result.selectExpression).toContain("coalesce(ts.NonBilledCost,");
        // ... then the legacy all-or-nothing boolean, then 0.
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.cost.non_billable'] = 'true', ts.TotalCost, 0",
        );
      });

      it("translates performance.first_token with p95 using quantileTDigest", () => {
        const result = translateMetric({
          metric: "performance.first_token",
          aggregation: "p95",
          index: 0,
        });
        // performance.* metrics opt into quantileTDigest for percentile
        // aggregations - ±5% tail error is fine on latency dashboards, and the
        // memory profile is bounded, not O(N).
        expect(result.selectExpression).toContain("quantileTDigest(0.95)");
        expect(result.selectExpression).toContain("TimeToFirstTokenMs");
      });

      it("translates performance.tokens_per_second using pre-aggregated trace-level column", () => {
        const result = translateMetric({
          metric: "performance.tokens_per_second",
          aggregation: "avg",
          index: 0,
        });
        // Uses pre-aggregated TokensPerSecond from trace_summaries to avoid
        // reading SpanAttributes (Map column with large LLM text), which causes OOM.
        expect(result.selectExpression).toContain("TokensPerSecond");
        expect(result.selectExpression).not.toContain("stored_spans");
        expect(result.selectExpression).not.toContain("SpanAttributes");
        expect(result.selectExpression).not.toContain(
          "gen_ai.usage.output_tokens",
        );
        expect(result.requiredJoins).not.toContain("stored_spans");
      });

      it("translates performance.tokens_per_second with percentile aggregation using quantileTDigest", () => {
        const result = translateMetric({
          metric: "performance.tokens_per_second",
          aggregation: "p95",
          index: 0,
        });
        expect(result.selectExpression).toContain("quantileTDigest(0.95)");
        expect(result.selectExpression).toContain("TokensPerSecond");
        expect(result.requiredJoins).not.toContain("stored_spans");
      });

      it("translates performance.total_tokens", () => {
        const result = translateMetric({
          metric: "performance.total_tokens",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain("TotalPromptTokenCount");
        expect(result.selectExpression).toContain("TotalCompletionTokenCount");
      });

      it("translates performance.cache_read_tokens from the reserved attribute key", () => {
        const result = translateMetric({
          metric: "performance.cache_read_tokens",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.reserved.cache_read_tokens']",
        );
        expect(result.selectExpression).toContain("toUInt64OrZero");
      });

      it("translates performance.cache_write_tokens from the reserved attribute key", () => {
        const result = translateMetric({
          metric: "performance.cache_write_tokens",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.reserved.cache_creation_tokens']",
        );
      });

      it("translates performance.total_processed_tokens as input+output+cache", () => {
        const result = translateMetric({
          metric: "performance.total_processed_tokens",
          aggregation: "sum",
          index: 0,
        });
        expect(result.selectExpression).toContain("TotalPromptTokenCount");
        expect(result.selectExpression).toContain("TotalCompletionTokenCount");
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.reserved.cache_read_tokens']",
        );
        expect(result.selectExpression).toContain(
          "Attributes['langwatch.reserved.cache_creation_tokens']",
        );
      });
    });

    describe("evaluation metrics", () => {
      it("translates evaluations.evaluation_score and requires JOIN", () => {
        const result = translateMetric({
          metric: "evaluations.evaluation_score",
          aggregation: "avg",
          index: 0,
        });
        expect(result.selectExpression).toContain("es.Score");
        expect(result.selectExpression).toContain("Status = 'processed'");
        expect(result.requiredJoins).toContain("evaluation_runs");
      });

      it("translates evaluations.evaluation_score with evaluator key using parameterized query", () => {
        const result = translateMetric({
          metric: "evaluations.evaluation_score",
          aggregation: "avg",
          index: 0,
          key: "eval-123",
        });
        // Should use parameterized query for evaluator ID (SQL injection prevention)
        expect(result.selectExpression).toMatch(
          /es\.EvaluatorId = \{m_evaluatorId_[a-f0-9]+:String\}/,
        );
        // Params should contain the evaluator ID value
        const paramKey = Object.keys(result.params).find((k) =>
          k.startsWith("m_evaluatorId_"),
        );
        expect(paramKey).toBeDefined();
        expect(result.params[paramKey!]).toBe("eval-123");
      });

      it("translates evaluations.evaluation_pass_rate", () => {
        const result = translateMetric({
          metric: "evaluations.evaluation_pass_rate",
          aggregation: "avg",
          index: 0,
        });
        expect(result.selectExpression).toContain("es.Passed");
        expect(result.requiredJoins).toContain("evaluation_runs");
      });

      it("translates evaluations.evaluation_runs", () => {
        const result = translateMetric({
          metric: "evaluations.evaluation_runs",
          aggregation: "cardinality",
          index: 0,
        });
        expect(result.selectExpression).toContain("uniqIf");
        expect(result.selectExpression).toContain("EvaluationId");
      });
    });

    describe("event metrics", () => {
      it("translates events.event_type and requires stored_spans JOIN", () => {
        const result = translateMetric({
          metric: "events.event_type",
          aggregation: "cardinality",
          index: 0,
        });
        expect(result.requiredJoins).toContain("stored_spans");
      });

      it("translates events.event_type with event type key using parameterized query", () => {
        const result = translateMetric({
          metric: "events.event_type",
          aggregation: "cardinality",
          index: 0,
          key: "thumbs_up_down",
        });
        expect(result.selectExpression).toContain("countIf");
        // Should use parameterized query for event type (SQL injection prevention)
        expect(result.selectExpression).toMatch(
          /\{m_eventType_[a-f0-9]+:String\}/,
        );
        // Params should contain the event type value
        const paramKey = Object.keys(result.params).find((k) =>
          k.startsWith("m_eventType_"),
        );
        expect(paramKey).toBeDefined();
        expect(result.params[paramKey!]).toBe("thumbs_up_down");
      });
    });

    describe("sentiment metrics", () => {
      describe("when aggregation is cardinality", () => {
        it("counts traces with thumbs_up_down events using countIf", () => {
          const result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "cardinality",
            index: 0,
          });
          expect(result.selectExpression).toContain("countIf");
          expect(result.selectExpression).toMatch(
            /\{m_sentimentEventType_[a-f0-9]+:String\}/,
          );
          const eventTypeParam = Object.keys(result.params).find((k) =>
            k.startsWith("m_sentimentEventType_"),
          );
          expect(eventTypeParam).toBeDefined();
          expect(result.params[eventTypeParam!]).toBe("thumbs_up_down");
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });

      describe("when aggregation is sum", () => {
        let result: ReturnType<typeof translateMetric>;

        beforeEach(() => {
          result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "sum",
            index: 0,
          });
        });

        it("extracts vote values and applies sumArray", () => {
          expect(result.selectExpression).toContain("sumArray");
          expect(result.requiredJoins).toContain("stored_spans");
        });

        it("filters to thumbs_up_down events using parameterized query", () => {
          expect(result.selectExpression).toMatch(
            /\{m_sentimentEventType_[a-f0-9]+:String\}/,
          );
          const eventTypeParam = Object.keys(result.params).find((k) =>
            k.startsWith("m_sentimentEventType_"),
          );
          expect(eventTypeParam).toBeDefined();
          expect(result.params[eventTypeParam!]).toBe("thumbs_up_down");
        });

        it("extracts event.metrics.vote using parameterized query", () => {
          const voteKeyParam = Object.keys(result.params).find((k) =>
            k.startsWith("m_sentimentVoteKey_"),
          );
          expect(voteKeyParam).toBeDefined();
          expect(result.params[voteKeyParam!]).toBe("event.metrics.vote");
        });

        it("excludes zero values from the extraction", () => {
          expect(result.selectExpression).toContain("x != 0");
        });
      });

      describe("when aggregation is avg", () => {
        it("extracts vote values and applies avgArray", () => {
          const result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "avg",
            index: 0,
          });
          expect(result.selectExpression).toContain("avgArray");
          expect(result.selectExpression).toContain("x != 0");
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });

      describe("when aggregation is min", () => {
        it("extracts vote values and applies minArray", () => {
          const result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "min",
            index: 0,
          });
          expect(result.selectExpression).toContain("minArray");
          expect(result.selectExpression).toContain("x != 0");
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });

      describe("when aggregation is max", () => {
        it("extracts vote values and applies maxArray", () => {
          const result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "max",
            index: 0,
          });
          expect(result.selectExpression).toContain("maxArray");
          expect(result.selectExpression).toContain("x != 0");
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });

      describe("when aggregation is a percentile", () => {
        it("extracts vote values and applies quantileExactArray", () => {
          const result = translateMetric({
            metric: "sentiment.thumbs_up_down",
            aggregation: "p95",
            index: 0,
          });
          expect(result.selectExpression).toContain("quantileExactArray(0.95)");
          expect(result.selectExpression).toContain("x != 0");
          expect(result.requiredJoins).toContain("stored_spans");
        });
      });
    });

    describe("threads metrics", () => {
      it("translates threads.average_duration_per_thread with subquery", () => {
        const result = translateMetric({
          metric: "threads.average_duration_per_thread",
          aggregation: "avg",
          index: 0,
        });
        expect(result.requiresSubquery).toBe(true);
        expect(result.subquery).toBeDefined();
        expect(result.subquery?.innerSelect).toContain("thread_id");
        expect(result.subquery?.innerGroupBy).toBe("thread_id");
      });
    });

    describe("aggregation types", () => {
      it("uses uniq() for cardinality aggregation", () => {
        const result = translateMetric({
          metric: "metadata.trace_id",
          aggregation: "cardinality",
          index: 0,
        });
        expect(result.selectExpression).toContain("uniq(");
      });

      it("uses quantileTDigest for performance.* percentile aggregations", () => {
        const result = translateMetric({
          metric: "performance.completion_time",
          aggregation: "p99",
          index: 0,
        });
        expect(result.selectExpression).toContain("quantileTDigest(0.99)");
      });

      it("keeps quantileExact for evaluation score percentiles", () => {
        // Evaluation scores stay on quantileExact - their distributions are
        // narrow enough that ±5% can flip threshold-based dashboard outcomes.
        const result = translateMetric({
          metric: "evaluations.evaluation_score",
          aggregation: "p99",
          index: 0,
          key: "eval-1",
        });
        expect(result.selectExpression).toContain("quantileExactIf(0.99)");
        expect(result.selectExpression).not.toContain("quantileTDigest");
      });

      it("uses correct aggregation for min/max", () => {
        const minResult = translateMetric({
          metric: "performance.completion_time",
          aggregation: "min",
          index: 0,
        });
        expect(minResult.selectExpression).toContain("min(");

        const maxResult = translateMetric({
          metric: "performance.completion_time",
          aggregation: "max",
          index: 1,
        });
        expect(maxResult.selectExpression).toContain("max(");
      });
    });
  });

  describe("translatePipelineAggregation", () => {
    it("creates subquery for per-user aggregation", () => {
      const result = translatePipelineAggregation({
        metric: "performance.total_cost",
        aggregation: "sum",
        pipelineField: "user_id",
        pipelineAggregation: "avg",
        index: 0,
      });
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery?.innerSelect).toContain(
        "Attributes['langwatch.user_id']",
      );
      expect(result.subquery?.innerGroupBy).toBe("pipeline_key");
      expect(result.subquery?.outerAggregation).toContain("avg(inner_value)");
    });

    it("creates subquery for per-thread aggregation", () => {
      const result = translatePipelineAggregation({
        metric: "performance.completion_time",
        aggregation: "avg",
        pipelineField: "thread_id",
        pipelineAggregation: "sum",
        index: 0,
      });
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery?.innerSelect).toContain(
        "Attributes['gen_ai.conversation.id']",
      );
      expect(result.subquery?.outerAggregation).toContain("sum(inner_value)");
    });

    it("creates subquery for per-trace aggregation", () => {
      const result = translatePipelineAggregation({
        metric: "performance.total_cost",
        aggregation: "sum",
        pipelineField: "trace_id",
        pipelineAggregation: "max",
        index: 0,
      });
      expect(result.subquery?.innerSelect).toContain("TraceId");
      expect(result.subquery?.outerAggregation).toContain("max(inner_value)");
    });

    it("inherits required JOINs from inner metric", () => {
      const result = translatePipelineAggregation({
        metric: "evaluations.evaluation_score",
        aggregation: "avg",
        pipelineField: "user_id",
        pipelineAggregation: "avg",
        index: 0,
        key: "eval-123",
      });
      expect(result.requiredJoins).toContain("evaluation_runs");
    });

    it("handles threads.average_duration_per_thread with pipeline using nested subquery", () => {
      // threads.average_duration_per_thread with a pipeline requires 3-level aggregation:
      // 1. Group by (user_id, thread_id), compute thread duration
      // 2. Group by user_id, compute avg thread duration per user
      // 3. Compute avg across users
      const result = translatePipelineAggregation({
        metric: "threads.average_duration_per_thread",
        aggregation: "avg",
        pipelineField: "user_id",
        pipelineAggregation: "avg",
        index: 0,
      });

      // Returns a subquery with nested structure
      expect(result.requiresSubquery).toBe(true);
      expect(result.subquery).toBeDefined();
      expect(result.subquery?.nestedSubquery).toBeDefined();
      expect(result.subquery?.nestedSubquery?.select).toContain(
        "thread_duration",
      );
      expect(result.subquery?.innerSelect).toContain("avg(thread_duration)");
      expect(result.selectExpression).toContain("avg(user_avg_duration)");
    });
  });
});
