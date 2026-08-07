import { beforeEach, describe, expect, it } from "vitest";
import {
  combineFilters,
  type FilterTranslation,
  resetParamCounter,
  translateAllFilters,
  translateFilter,
} from "../filter-translator";

describe("filter-translator", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  describe("translateFilter", () => {
    describe("topic filters", () => {
      it("translates topics.topics filter with parameterized query", () => {
        const result = translateFilter({
          field: "topics.topics",
          values: ["topic-1", "topic-2"],
        });
        expect(result.whereClause).toContain("ts.TopicId IN");
        expect(result.whereClause).toContain("{topicIds_0:Array(String)}");
        expect(result.params).toEqual({ topicIds_0: ["topic-1", "topic-2"] });
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates topics.subtopics filter with parameterized query", () => {
        const result = translateFilter({
          field: "topics.subtopics",
          values: ["subtopic-1"],
        });
        expect(result.whereClause).toContain("ts.SubTopicId IN");
        expect(result.whereClause).toContain("{subtopicIds_0:Array(String)}");
        expect(result.params).toEqual({ subtopicIds_0: ["subtopic-1"] });
      });
    });

    describe("metadata filters", () => {
      it("translates metadata.user_id filter with parameterized query", () => {
        const result = translateFilter({
          field: "metadata.user_id",
          values: ["user-1", "user-2"],
        });
        expect(result.whereClause).toContain(
          "ts.Attributes[{metaValues_0_key:String}]",
        );
        expect(result.whereClause).toContain(
          "IN ({metaValues_0:Array(String)})",
        );
        expect(result.params).toEqual({
          metaValues_0_key: "langwatch.user_id",
          metaValues_0: ["user-1", "user-2"],
        });
      });

      it("translates metadata.thread_id filter with parameterized query", () => {
        const result = translateFilter({
          field: "metadata.thread_id",
          values: ["thread-1"],
        });
        expect(result.whereClause).toContain(
          "ts.Attributes[{metaValues_0_key:String}]",
        );
        expect(result.params).toHaveProperty(
          "metaValues_0_key",
          "gen_ai.conversation.id",
        );
      });

      it("translates metadata.customer_id filter with parameterized query", () => {
        const result = translateFilter({
          field: "metadata.customer_id",
          values: ["customer-1"],
        });
        expect(result.params).toHaveProperty(
          "metaValues_0_key",
          "langwatch.customer_id",
        );
      });

      it("translates metadata.labels filter with parameterized query", () => {
        const result = translateFilter({
          field: "metadata.labels",
          values: ["label1", "label2"],
        });
        expect(result.whereClause).toContain("hasAny");
        expect(result.whereClause).toContain("JSONExtract");
        expect(result.whereClause).toContain("langwatch.labels");
        expect(result.whereClause).toContain("{labels_0:Array(String)}");
        expect(result.params).toEqual({ labels_0: ["label1", "label2"] });
      });

      it("translates metadata.key filter with parameterized query", () => {
        const result = translateFilter({
          field: "metadata.key",
          values: ["custom_key"],
        });
        expect(result.whereClause).toContain("arrayExists");
        expect(result.whereClause).toContain("mapContains");
        expect(result.whereClause).toContain("{metaKeys_0:Array(String)}");
        expect(result.params).toEqual({ metaKeys_0: ["custom_key"] });
      });

      it("translates metadata.value filter with key using parameterized query", () => {
        const result = translateFilter({
          field: "metadata.value",
          values: ["value1", "value2"],
          key: "custom_key",
        });
        expect(result.whereClause).toContain(
          "ts.Attributes[{metaValue_0_key:String}]",
        );
        expect(result.whereClause).toContain(
          "IN ({metaValue_0:Array(String)})",
        );
        expect(result.params).toEqual({
          metaValue_0_key: "custom_key",
          metaValue_0: ["value1", "value2"],
        });
      });

      it("handles dots replaced with · in metadata.value key", () => {
        const result = translateFilter({
          field: "metadata.value",
          values: ["value"],
          key: "key·with·dots",
        });
        expect(result.params).toHaveProperty(
          "metaValue_0_key",
          "key.with.dots",
        );
      });
    });

    describe("trace filters", () => {
      describe("when filtering by origin", () => {
        /** @scenario "ClickHouse origin filter for specific values" */
        it("translates non-application origin values with IN clause", () => {
          const result = translateFilter({
            field: "traces.origin",
            values: ["evaluation"],
          });
          expect(result.whereClause).toContain(
            "ts.Attributes['langwatch.origin'] IN",
          );
          expect(result.whereClause).toContain(
            "{originValues_0:Array(String)}",
          );
          expect(result.params).toEqual({ originValues_0: ["evaluation"] });
          expect(result.requiredJoins).toHaveLength(0);
        });

        /** @scenario 'ClickHouse origin filter for "application" matches absent values' */
        it("translates application origin as empty-or-null-or-literal check", () => {
          const result = translateFilter({
            field: "traces.origin",
            values: ["application"],
          });
          expect(result.whereClause).toContain(
            "ts.Attributes['langwatch.origin'] = ''",
          );
          expect(result.whereClause).toContain("IS NULL");
          expect(result.whereClause).toContain("= 'application'");
          expect(result.params).toEqual({});
        });

        /** @scenario 'ClickHouse origin filter for mixed values including "application"' */
        it("combines application and other origins with OR", () => {
          const result = translateFilter({
            field: "traces.origin",
            values: ["application", "simulation", "playground"],
          });
          expect(result.whereClause).toContain("OR");
          expect(result.whereClause).toContain(
            "ts.Attributes['langwatch.origin'] = ''",
          );
          expect(result.whereClause).toContain("IS NULL");
          expect(result.whereClause).toContain(
            "IN ({originValues_0:Array(String)})",
          );
          expect(result.params).toEqual({
            originValues_0: ["simulation", "playground"],
          });
        });

        it("returns 1=0 for empty values array (no origins selected)", () => {
          const result = translateFilter({
            field: "traces.origin",
            values: [],
          });
          expect(result.whereClause).toBe("1=1"); // empty array returns noOp from translateFilter
        });
      });

      it("translates traces.error filter for true using ContainsErrorStatus", () => {
        const result = translateFilter({
          field: "traces.error",
          values: ["true"],
        });
        expect(result.whereClause).toContain("ts.ContainsErrorStatus = 1");
        expect(result.params).toEqual({});
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("translates traces.error filter for false using ContainsErrorStatus", () => {
        const result = translateFilter({
          field: "traces.error",
          values: ["false"],
        });
        expect(result.whereClause).toContain("ts.ContainsErrorStatus = 0");
        expect(result.whereClause).toContain("IS NULL");
        expect(result.params).toEqual({});
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("returns no-op when both true and false are specified", () => {
        const result = translateFilter({
          field: "traces.error",
          values: ["true", "false"],
        });
        expect(result.whereClause).toBe("1=1");
        expect(result.params).toEqual({});
      });
    });

    describe("span filters", () => {
      it("translates spans.type filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "spans.type",
          values: ["llm", "agent"],
        });
        // Regression guard: issue #2660
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("stored_spans");
        expect(result.whereClause).toContain("langwatch.span.type");
        expect(result.whereClause).toContain("{spanTypes_0:Array(String)}");
        expect(result.params).toEqual({ spanTypes_0: ["llm", "agent"] });
      });

      it("translates spans.model filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "spans.model",
          values: ["gpt-4", "claude-3"],
        });
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("gen_ai.request.model");
        expect(result.whereClause).toContain("{models_0:Array(String)}");
        expect(result.params).toEqual({ models_0: ["gpt-4", "claude-3"] });
      });
    });

    describe("when a span or event facet filter targets stored_spans", () => {
      // The stored_spans facet subqueries must accept a StartTime predicate so
      // they prune to the dashboard's date range instead of cold-scanning every
      // weekly partition on S3. The predicate is the caller's responsibility
      // (aggregation-builder passes the date envelope); the translator just has
      // to thread it into the subquery WHERE.
      const SPAN_TIME = "AND StartTime >= {startDate:DateTime64(3)}";
      const SPAN_SUBQUERY_FILTERS = [
        { field: "spans.type", values: ["llm"], key: undefined },
        { field: "spans.model", values: ["gpt-4"], key: undefined },
        { field: "events.event_type", values: ["feedback"], key: undefined },
        { field: "events.metrics.key", values: ["score"], key: "feedback" },
        {
          field: "events.event_details.key",
          values: ["note"],
          key: "feedback",
        },
      ] as const;

      for (const { field, values, key } of SPAN_SUBQUERY_FILTERS) {
        it(`injects the StartTime predicate into the ${field} subquery`, () => {
          const result = translateFilter({
            field,
            values: [...values],
            key,
            spanTimePredicate: SPAN_TIME,
          });
          expect(result.whereClause).toContain("stored_spans");
          expect(result.whereClause).toContain(SPAN_TIME);
        });

        it(`omits the StartTime predicate for ${field} when none is given (unchanged behavior)`, () => {
          const result = translateFilter({ field, values: [...values], key });
          expect(result.whereClause).toContain("stored_spans");
          expect(result.whereClause).not.toContain("StartTime");
        });
      }

      it("leaves non-span filters untouched even when a predicate is supplied", () => {
        const result = translateFilter({
          field: "topics.topics",
          values: ["topic-1"],
          spanTimePredicate: SPAN_TIME,
        });
        expect(result.whereClause).not.toContain("StartTime");
        expect(result.whereClause).not.toContain("stored_spans");
      });
    });

    describe("evaluation filters", () => {
      it("translates evaluations.evaluator_id filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "evaluations.evaluator_id",
          values: ["eval-1", "eval-2"],
        });
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("evaluation_runs");
        expect(result.whereClause).toContain(
          "EvaluatorId IN ({evaluatorIds_0:Array(String)})",
        );
        expect(result.params).toEqual({ evaluatorIds_0: ["eval-1", "eval-2"] });
      });

      it("translates evaluations.evaluator_id.has_passed filter with Passed IS NOT NULL predicate", () => {
        const result = translateFilter({
          field: "evaluations.evaluator_id.has_passed",
          values: ["eval-1"],
        });
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain(
          "EvaluatorId IN ({evaluatorIds_0:Array(String)})",
        );
        expect(result.whereClause).toContain("AND Passed IS NOT NULL");
        expect(result.params).toEqual({ evaluatorIds_0: ["eval-1"] });
      });

      it("translates evaluations.evaluator_id.has_score filter with Score IS NOT NULL predicate", () => {
        const result = translateFilter({
          field: "evaluations.evaluator_id.has_score",
          values: ["eval-1"],
        });
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain(
          "EvaluatorId IN ({evaluatorIds_0:Array(String)})",
        );
        expect(result.whereClause).toContain("AND Score IS NOT NULL");
        expect(result.params).toEqual({ evaluatorIds_0: ["eval-1"] });
      });

      it("translates evaluations.evaluator_id.has_label filter with Label exclusion predicate", () => {
        const result = translateFilter({
          field: "evaluations.evaluator_id.has_label",
          values: ["eval-1"],
        });
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain(
          "EvaluatorId IN ({evaluatorIds_0:Array(String)})",
        );
        expect(result.whereClause).toContain("AND Label IS NOT NULL");
        expect(result.whereClause).toContain("AND Label != ''");
        expect(result.whereClause).toContain(
          "AND Label NOT IN ('succeeded', 'failed')",
        );
        expect(result.params).toEqual({ evaluatorIds_0: ["eval-1"] });
      });

      it("translates base evaluations.evaluator_id without additional predicates", () => {
        const result = translateFilter({
          field: "evaluations.evaluator_id",
          values: ["eval-1"],
        });
        expect(result.whereClause).toContain(
          "EvaluatorId IN ({evaluatorIds_0:Array(String)})",
        );
        expect(result.whereClause).not.toContain("Passed IS NOT NULL");
        expect(result.whereClause).not.toContain("Score IS NOT NULL");
        expect(result.whereClause).not.toContain("Label IS NOT NULL");
      });

      it("translates evaluations.passed filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "evaluations.passed",
          values: ["true"],
        });
        // Regression guard: issue #2660
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain(
          "Passed IN ({evalPassed_0:Array(UInt8)})",
        );
        expect(result.params).toEqual({ evalPassed_0: [1] });
      });

      it("translates evaluations.passed filter with evaluator key", () => {
        const result = translateFilter({
          field: "evaluations.passed",
          values: ["true"],
          key: "eval-123",
        });
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain(
          "EvaluatorId = {evaluatorId_1:String}",
        );
        expect(result.whereClause).toContain(
          "Passed IN ({evalPassed_0:Array(UInt8)})",
        );
        expect(result.params).toEqual({
          evalPassed_0: [1],
          evaluatorId_1: "eval-123",
        });
      });

      it("translates evaluations.score filter with parameterized numeric range", () => {
        const result = translateFilter({
          field: "evaluations.score",
          values: ["0.5", "1.0"],
          key: "eval-123",
        });
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("Score >= {scoreMin_0:Float64}");
        expect(result.whereClause).toContain("Score <= {scoreMax_1:Float64}");
        expect(result.params).toHaveProperty("scoreMin_0", 0.5);
        expect(result.params).toHaveProperty("scoreMax_1", 1);
        expect(result.params).toHaveProperty("evaluatorId_2", "eval-123");
      });

      it("translates evaluations.label filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "evaluations.label",
          values: ["good", "bad"],
          key: "eval-123",
        });
        // Regression guard: issue #2660
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain(
          "Label IN ({evalLabels_0:Array(String)})",
        );
        expect(result.params).toHaveProperty("evalLabels_0", ["good", "bad"]);
        expect(result.params).toHaveProperty("evaluatorId_1", "eval-123");
      });

      it("translates evaluations.state filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "evaluations.state",
          values: ["processed"],
        });
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain(
          "Status IN ({evalStates_0:Array(String)})",
        );
        expect(result.params).toEqual({ evalStates_0: ["processed"] });
      });
    });

    describe("event filters", () => {
      it("translates events.event_type filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "events.event_type",
          values: ["thumbs_up_down", "feedback"],
        });
        // Regression guard: issue #2660
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain(
          'hasAny("Events.Name", {eventTypes_0:Array(String)})',
        );
        expect(result.params).toEqual({
          eventTypes_0: ["thumbs_up_down", "feedback"],
        });
      });

      it("translates events.metrics.key filter with parameterized IN subquery", () => {
        const result = translateFilter({
          field: "events.metrics.key",
          values: ["vote"],
          key: "thumbs_up_down",
        });
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("arrayExists");
        expect(result.whereClause).toContain("mapContains");
        expect(result.whereClause).toContain("{metricKeys_0:Array(String)}");
        expect(result.params).toHaveProperty("metricKeys_0", ["vote"]);
        expect(result.params).toHaveProperty("eventType_1", "thumbs_up_down");
      });

      it("translates events.metrics.value filter with parameterized range", () => {
        const result = translateFilter({
          field: "events.metrics.value",
          values: ["0", "1"],
          key: "thumbs_up_down",
          subkey: "vote",
        });
        expect(result.whereClause).not.toContain("EXISTS");
        expect(result.whereClause).toContain("ts.TraceId IN");
        expect(result.whereClause).toContain("TenantId = {tenantId:String}");
        expect(result.whereClause).toContain("toFloat64OrNull");
        expect(result.whereClause).toContain(">= {metricMin_1:Float64}");
        expect(result.whereClause).toContain("<= {metricMax_2:Float64}");
        expect(result.params).toHaveProperty("metricKey_0", "vote");
        expect(result.params).toHaveProperty("metricMin_1", 0);
        expect(result.params).toHaveProperty("metricMax_2", 1);
        expect(result.params).toHaveProperty("eventType_3", "thumbs_up_down");
      });
    });

    describe("annotation filters", () => {
      it("translates annotations.hasAnnotation filter for true", () => {
        const result = translateFilter({
          field: "annotations.hasAnnotation",
          values: ["true"],
        });
        expect(result.whereClause).toContain("ts.HasAnnotation = true");
        expect(result.params).toEqual({});
      });

      it("translates annotations.hasAnnotation filter for false", () => {
        const result = translateFilter({
          field: "annotations.hasAnnotation",
          values: ["false"],
        });
        expect(result.whereClause).toContain("ts.HasAnnotation = false");
        expect(result.params).toEqual({});
      });
    });

    describe("edge cases", () => {
      it("returns no-op for empty values array", () => {
        const result = translateFilter({ field: "topics.topics", values: [] });
        expect(result.whereClause).toBe("1=1");
        expect(result.params).toEqual({});
      });

      it("returns no-op for unknown filter field", () => {
        const result = translateFilter({
          field: "unknown.field" as any,
          values: ["value"],
        });
        expect(result.whereClause).toBe("1=1");
        expect(result.params).toEqual({});
      });

      it("passes malicious values safely through parameters", () => {
        // With parameterized queries, SQL injection attempts are safely contained
        const result = translateFilter({
          field: "topics.topics",
          values: ["topic'with'quotes"],
        });
        expect(result.whereClause).not.toContain("topic'with'quotes");
        expect(result.params.topicIds_0).toContain("topic'with'quotes");
      });
    });
  });

  describe("combineFilters", () => {
    it("combines multiple filter translations with AND", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: [], params: { a: 1 } },
        { whereClause: "b = 2", requiredJoins: [], params: { b: 2 } },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("(a = 1) AND (b = 2)");
      expect(result.params).toEqual({ a: 1, b: 2 });
    });

    it("skips trivial filters (1=1)", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: [], params: { a: 1 } },
        { whereClause: "1=1", requiredJoins: [], params: {} },
        { whereClause: "b = 2", requiredJoins: [], params: { b: 2 } },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("(a = 1) AND (b = 2)");
      expect(result.params).toEqual({ a: 1, b: 2 });
    });

    it("returns no-op when all filters are trivial", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "1=1", requiredJoins: [], params: {} },
        { whereClause: "1=1", requiredJoins: [], params: {} },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("1=1");
      expect(result.params).toEqual({});
    });

    it("collects all required joins", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: ["stored_spans"], params: {} },
        {
          whereClause: "b = 2",
          requiredJoins: ["evaluation_runs"],
          params: {},
        },
        { whereClause: "c = 3", requiredJoins: ["stored_spans"], params: {} },
      ];
      const result = combineFilters(filters);
      expect(result.requiredJoins).toContain("stored_spans");
      expect(result.requiredJoins).toContain("evaluation_runs");
      expect(result.requiredJoins).toHaveLength(2); // Deduplicated
    });

    it("merges params from all filters", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = {p1:Int}", requiredJoins: [], params: { p1: 10 } },
        {
          whereClause: "b = {p2:String}",
          requiredJoins: [],
          params: { p2: "test" },
        },
      ];
      const result = combineFilters(filters);
      expect(result.params).toEqual({ p1: 10, p2: "test" });
    });
  });

  describe("translateAllFilters", () => {
    it("translates simple array filters with params", () => {
      const filters = {
        "topics.topics": ["topic-1"],
        "metadata.user_id": ["user-1"],
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).toContain("ts.TopicId");
      expect(result.whereClause).toContain(" AND ");
      expect(result.params).toHaveProperty("topicIds_0", ["topic-1"]);
    });

    it("translates nested filters with key and params", () => {
      const filters = {
        "evaluations.passed": {
          "eval-123": ["true"],
        },
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).toContain(
        "EvaluatorId = {evaluatorId_1:String}",
      );
      expect(result.whereClause).toContain(
        "Passed IN ({evalPassed_0:Array(UInt8)})",
      );
      expect(result.params).toHaveProperty("evaluatorId_1", "eval-123");
      expect(result.params).toHaveProperty("evalPassed_0", [1]);
    });

    it("translates double nested filters with key and subkey", () => {
      const filters = {
        "events.metrics.value": {
          thumbs_up_down: {
            vote: ["0", "1"],
          },
        },
      };
      const result = translateAllFilters(filters);
      expect(result.params).toHaveProperty("metricKey_0", "vote");
      expect(result.params).toHaveProperty("metricMin_1", 0);
      expect(result.params).toHaveProperty("metricMax_2", 1);
      expect(result.params).toHaveProperty("eventType_3", "thumbs_up_down");
    });

    it("skips empty filter values", () => {
      const filters = {
        "topics.topics": [],
        "metadata.user_id": ["user-1"],
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).not.toContain("TopicId");
      expect(
        Object.keys(result.params).some((k) => k.startsWith("metaValues")),
      ).toBe(true);
    });

    it("returns no-op for empty filters", () => {
      const result = translateAllFilters({});
      expect(result.whereClause).toBe("1=1");
      expect(result.params).toEqual({});
    });
  });

  describe("SQL injection prevention", () => {
    it("safely handles malicious topic values", () => {
      const result = translateFilter({
        field: "topics.topics",
        values: ["'; DROP TABLE trace_summaries; --"],
      });
      // With parameterized queries, value goes in params, not SQL string
      expect(result.whereClause).not.toContain("DROP TABLE");
      expect(result.params.topicIds_0).toContain(
        "'; DROP TABLE trace_summaries; --",
      );
    });

    it("safely handles malicious metadata values", () => {
      const result = translateFilter({
        field: "metadata.user_id",
        values: ["user'); DELETE FROM users; --"],
      });
      expect(result.whereClause).not.toContain("DELETE");
      expect(result.params.metaValues_0).toContain(
        "user'); DELETE FROM users; --",
      );
    });

    it("safely handles backslash injection attempts", () => {
      const result = translateFilter({
        field: "topics.topics",
        values: ["topic\\'; DROP TABLE--"],
      });
      expect(result.whereClause).not.toContain("DROP TABLE");
      expect(result.params.topicIds_0).toContain("topic\\'; DROP TABLE--");
    });

    it("safely handles null byte injection attempts", () => {
      const result = translateFilter({
        field: "topics.topics",
        values: ["topic\x00'; DROP TABLE--"],
      });
      expect(result.whereClause).not.toContain("DROP TABLE");
      expect(result.params.topicIds_0).toContain("topic\x00'; DROP TABLE--");
    });

    it("safely handles unicode injection attempts", () => {
      const result = translateFilter({
        field: "evaluations.label",
        values: ["label＇; DROP TABLE--"],
      });
      expect(result.whereClause).not.toContain("DROP TABLE");
      expect(result.params.evalLabels_0).toContain("label＇; DROP TABLE--");
    });
  });
});
