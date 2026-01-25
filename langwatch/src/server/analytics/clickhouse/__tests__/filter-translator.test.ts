import { describe, expect, it } from "vitest";
import {
  translateFilter,
  translateAllFilters,
  combineFilters,
  type FilterTranslation,
} from "../filter-translator";

describe("filter-translator", () => {
  describe("translateFilter", () => {
    describe("topic filters", () => {
      it("should translate topics.topics filter", () => {
        const result = translateFilter("topics.topics", ["topic-1", "topic-2"]);
        expect(result.whereClause).toContain("ts.TopicId IN");
        expect(result.whereClause).toContain("'topic-1'");
        expect(result.whereClause).toContain("'topic-2'");
        expect(result.requiredJoins).toHaveLength(0);
      });

      it("should translate topics.subtopics filter", () => {
        const result = translateFilter("topics.subtopics", ["subtopic-1"]);
        expect(result.whereClause).toContain("ts.SubTopicId IN");
        expect(result.whereClause).toContain("'subtopic-1'");
      });
    });

    describe("metadata filters", () => {
      it("should translate metadata.user_id filter", () => {
        const result = translateFilter("metadata.user_id", [
          "user-1",
          "user-2",
        ]);
        expect(result.whereClause).toContain(
          "ts.Attributes['langwatch.user_id']"
        );
        expect(result.whereClause).toContain("IN");
        expect(result.whereClause).toContain("'user-1'");
      });

      it("should translate metadata.thread_id filter", () => {
        const result = translateFilter("metadata.thread_id", ["thread-1"]);
        expect(result.whereClause).toContain(
          "ts.Attributes['gen_ai.conversation.id']"
        );
      });

      it("should translate metadata.customer_id filter", () => {
        const result = translateFilter("metadata.customer_id", ["customer-1"]);
        expect(result.whereClause).toContain(
          "ts.Attributes['langwatch.customer_id']"
        );
      });

      it("should translate metadata.labels filter with JSONExtract", () => {
        const result = translateFilter("metadata.labels", ["label1", "label2"]);
        expect(result.whereClause).toContain("JSONExtract");
        expect(result.whereClause).toContain("langwatch.labels");
        expect(result.whereClause).toContain("has(");
        expect(result.whereClause).toContain("'label1'");
        expect(result.whereClause).toContain(" OR ");
      });

      it("should translate metadata.key filter with mapContains", () => {
        const result = translateFilter("metadata.key", ["custom_key"]);
        expect(result.whereClause).toContain("mapContains");
        expect(result.whereClause).toContain("ts.Attributes");
        expect(result.whereClause).toContain("'custom_key'");
      });

      it("should translate metadata.value filter with key", () => {
        const result = translateFilter(
          "metadata.value",
          ["value1", "value2"],
          "custom_key"
        );
        expect(result.whereClause).toContain("ts.Attributes['custom_key']");
        expect(result.whereClause).toContain("IN");
        expect(result.whereClause).toContain("'value1'");
      });

      it("should handle dots replaced with · in metadata.value key", () => {
        const result = translateFilter("metadata.value", ["value"], "key·with·dots");
        expect(result.whereClause).toContain("ts.Attributes['key.with.dots']");
      });
    });

    describe("trace filters", () => {
      it("should translate traces.error filter for true", () => {
        const result = translateFilter("traces.error", ["true"]);
        expect(result.whereClause).toContain("ts.ContainsErrorStatus = 1");
      });

      it("should translate traces.error filter for false", () => {
        const result = translateFilter("traces.error", ["false"]);
        expect(result.whereClause).toContain("ts.ContainsErrorStatus = 0");
      });

      it("should return no-op when both true and false are specified", () => {
        const result = translateFilter("traces.error", ["true", "false"]);
        expect(result.whereClause).toBe("1=1");
      });
    });

    describe("span filters", () => {
      it("should translate spans.type filter with EXISTS subquery", () => {
        const result = translateFilter("spans.type", ["llm", "agent"]);
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("stored_spans");
        expect(result.whereClause).toContain("langwatch.span.type");
        expect(result.whereClause).toContain("'llm'");
        expect(result.whereClause).toContain("'agent'");
        expect(result.usesExistsSubquery).toBe(true);
      });

      it("should translate spans.model filter with EXISTS subquery", () => {
        const result = translateFilter("spans.model", ["gpt-4", "claude-3"]);
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("gen_ai.request.model");
        expect(result.whereClause).toContain("'gpt-4'");
        expect(result.whereClause).toContain("'claude-3'");
      });
    });

    describe("evaluation filters", () => {
      it("should translate evaluations.evaluator_id filter with EXISTS", () => {
        const result = translateFilter("evaluations.evaluator_id", [
          "eval-1",
          "eval-2",
        ]);
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("evaluation_states");
        expect(result.whereClause).toContain("es.EvaluatorId IN");
        expect(result.whereClause).toContain("'eval-1'");
      });

      it("should translate evaluations.passed filter", () => {
        const result = translateFilter("evaluations.passed", ["true"]);
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("es.Passed IN");
        expect(result.whereClause).toContain("1");
      });

      it("should translate evaluations.passed filter with evaluator key", () => {
        const result = translateFilter(
          "evaluations.passed",
          ["true"],
          "eval-123"
        );
        expect(result.whereClause).toContain("es.EvaluatorId = 'eval-123'");
        expect(result.whereClause).toContain("es.Passed IN");
      });

      it("should translate evaluations.score filter with numeric range", () => {
        const result = translateFilter(
          "evaluations.score",
          ["0.5", "1.0"],
          "eval-123"
        );
        expect(result.whereClause).toContain("es.Score >= 0.5");
        expect(result.whereClause).toContain("es.Score <= 1");
      });

      it("should translate evaluations.label filter", () => {
        const result = translateFilter(
          "evaluations.label",
          ["good", "bad"],
          "eval-123"
        );
        expect(result.whereClause).toContain("es.Label IN");
        expect(result.whereClause).toContain("'good'");
        expect(result.whereClause).toContain("'bad'");
      });

      it("should translate evaluations.state filter", () => {
        const result = translateFilter("evaluations.state", ["processed"]);
        expect(result.whereClause).toContain("es.Status IN");
        expect(result.whereClause).toContain("'processed'");
      });
    });

    describe("event filters", () => {
      it("should translate events.event_type filter", () => {
        const result = translateFilter("events.event_type", [
          "thumbs_up_down",
          "feedback",
        ]);
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain('has(ss."Events.Name"');
        expect(result.whereClause).toContain("'thumbs_up_down'");
        expect(result.whereClause).toContain(" OR ");
      });

      it("should translate events.metrics.key filter", () => {
        const result = translateFilter(
          "events.metrics.key",
          ["vote"],
          "thumbs_up_down"
        );
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("arrayExists");
        expect(result.whereClause).toContain("mapContains");
        expect(result.whereClause).toContain("'vote'");
      });

      it("should translate events.metrics.value filter with range", () => {
        const result = translateFilter(
          "events.metrics.value",
          ["0", "1"],
          "thumbs_up_down",
          "vote"
        );
        expect(result.whereClause).toContain("EXISTS");
        expect(result.whereClause).toContain("toFloat64OrNull");
        expect(result.whereClause).toContain(">= 0");
        expect(result.whereClause).toContain("<= 1");
      });
    });

    describe("annotation filters", () => {
      it("should translate annotations.hasAnnotation filter for true", () => {
        const result = translateFilter("annotations.hasAnnotation", ["true"]);
        expect(result.whereClause).toContain("ts.HasAnnotation = 1");
      });

      it("should translate annotations.hasAnnotation filter for false", () => {
        const result = translateFilter("annotations.hasAnnotation", ["false"]);
        expect(result.whereClause).toContain("ts.HasAnnotation = 0");
        expect(result.whereClause).toContain("IS NULL");
      });
    });

    describe("edge cases", () => {
      it("should return no-op for empty values array", () => {
        const result = translateFilter("topics.topics", []);
        expect(result.whereClause).toBe("1=1");
      });

      it("should return no-op for unknown filter field", () => {
        const result = translateFilter("unknown.field" as any, ["value"]);
        expect(result.whereClause).toBe("1=1");
      });

      it("should escape single quotes in values", () => {
        const result = translateFilter("topics.topics", ["topic'with'quotes"]);
        expect(result.whereClause).toContain("topic''with''quotes");
      });
    });
  });

  describe("combineFilters", () => {
    it("should combine multiple filter translations with AND", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: [] },
        { whereClause: "b = 2", requiredJoins: [] },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("(a = 1) AND (b = 2)");
    });

    it("should skip trivial filters (1=1)", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: [] },
        { whereClause: "1=1", requiredJoins: [] },
        { whereClause: "b = 2", requiredJoins: [] },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("(a = 1) AND (b = 2)");
    });

    it("should return no-op when all filters are trivial", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "1=1", requiredJoins: [] },
        { whereClause: "1=1", requiredJoins: [] },
      ];
      const result = combineFilters(filters);
      expect(result.whereClause).toBe("1=1");
    });

    it("should collect all required joins", () => {
      const filters: FilterTranslation[] = [
        { whereClause: "a = 1", requiredJoins: ["stored_spans"] },
        { whereClause: "b = 2", requiredJoins: ["evaluation_states"] },
        { whereClause: "c = 3", requiredJoins: ["stored_spans"] },
      ];
      const result = combineFilters(filters);
      expect(result.requiredJoins).toContain("stored_spans");
      expect(result.requiredJoins).toContain("evaluation_states");
      expect(result.requiredJoins).toHaveLength(2); // Deduplicated
    });
  });

  describe("translateAllFilters", () => {
    it("should translate simple array filters", () => {
      const filters = {
        "topics.topics": ["topic-1"],
        "metadata.user_id": ["user-1"],
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).toContain("ts.TopicId");
      expect(result.whereClause).toContain("langwatch.user_id");
      expect(result.whereClause).toContain(" AND ");
    });

    it("should translate nested filters with key", () => {
      const filters = {
        "evaluations.passed": {
          "eval-123": ["true"],
        },
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).toContain("es.EvaluatorId = 'eval-123'");
      expect(result.whereClause).toContain("es.Passed IN");
    });

    it("should translate double nested filters with key and subkey", () => {
      const filters = {
        "events.metrics.value": {
          thumbs_up_down: {
            vote: ["0", "1"],
          },
        },
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).toContain("thumbs_up_down");
      expect(result.whereClause).toContain("vote");
    });

    it("should skip empty filter values", () => {
      const filters = {
        "topics.topics": [],
        "metadata.user_id": ["user-1"],
      };
      const result = translateAllFilters(filters);
      expect(result.whereClause).not.toContain("TopicId");
      expect(result.whereClause).toContain("langwatch.user_id");
    });

    it("should return no-op for empty filters", () => {
      const result = translateAllFilters({});
      expect(result.whereClause).toBe("1=1");
    });
  });
});
