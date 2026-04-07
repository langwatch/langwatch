import { describe, expect, it } from "vitest";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "../types";
import {
  clickHouseFilterConditions,
  generateClickHouseFilterConditions,
} from "../clickhouse/filter-conditions";

describe("clickHouseFilterConditions", () => {
  describe("topics.topics", () => {
    it("generates IN clause with parameterized values", () => {
      const builder = clickHouseFilterConditions["topics.topics"];
      expect(builder).not.toBeNull();
      const result = builder!(["topic1", "topic2"], "f0");
      expect(result.sql).toBe("ts.TopicId IN ({f0_values:Array(String)})");
      expect(result.params).toEqual({ f0_values: ["topic1", "topic2"] });
    });
  });

  describe("traces.error", () => {
    it("returns true condition when only true selected", () => {
      const builder = clickHouseFilterConditions["traces.error"];
      expect(builder).not.toBeNull();
      const result = builder!(["true"], "f0");
      expect(result.sql).toBe("ts.ContainsErrorStatus = true");
      expect(result.params).toEqual({});
    });

    it("returns false condition when only false selected", () => {
      const builder = clickHouseFilterConditions["traces.error"];
      const result = builder!(["false"], "f0");
      expect(result.sql).toBe("ts.ContainsErrorStatus = false");
    });

    it("returns 1=1 when both true and false selected", () => {
      const builder = clickHouseFilterConditions["traces.error"];
      const result = builder!(["true", "false"], "f0");
      expect(result.sql).toBe("1=1");
    });

    it("returns 1=0 when no values selected", () => {
      const builder = clickHouseFilterConditions["traces.error"];
      const result = builder!([], "f0");
      expect(result.sql).toBe("1=0");
    });
  });

  describe("traces.origin", () => {
    it("expands 'application' to match empty, NULL, and literal 'application'", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      expect(builder).not.toBeNull();
      const result = builder!(["application"], "f0");
      expect(result.sql).toBe(
        "(ts.Attributes['langwatch.origin'] = '' OR ts.Attributes['langwatch.origin'] IS NULL OR ts.Attributes['langwatch.origin'] = 'application')",
      );
      expect(result.params).toEqual({});
    });

    it("uses IN clause for specific non-application values", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["evaluation"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['langwatch.origin'] IN ({f0_values:Array(String)})",
      );
      expect(result.params).toEqual({ f0_values: ["evaluation"] });
    });

    it("combines application expansion with IN clause for mixed values", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["application", "evaluation"], "f0");
      expect(result.sql).toBe(
        "((ts.Attributes['langwatch.origin'] = '' OR ts.Attributes['langwatch.origin'] IS NULL OR ts.Attributes['langwatch.origin'] = 'application') OR ts.Attributes['langwatch.origin'] IN ({f0_values:Array(String)}))",
      );
      expect(result.params).toEqual({ f0_values: ["evaluation"] });
    });

    it("handles multiple non-application values", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["evaluation", "simulation"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['langwatch.origin'] IN ({f0_values:Array(String)})",
      );
      expect(result.params).toEqual({
        f0_values: ["evaluation", "simulation"],
      });
    });

    it("returns 1=0 when no values selected", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!([], "f0");
      expect(result.sql).toBe("1=0");
    });
  });

  describe("metadata filters", () => {
    it("generates user_id filter with langwatch.user_id attribute key", () => {
      const builder = clickHouseFilterConditions["metadata.user_id"];
      const result = builder!(["user1"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['langwatch.user_id'] IN ({f0_values:Array(String)})"
      );
    });

    it("generates thread_id filter with gen_ai.conversation.id attribute key", () => {
      const builder = clickHouseFilterConditions["metadata.thread_id"];
      const result = builder!(["thread1"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['gen_ai.conversation.id'] IN ({f0_values:Array(String)})"
      );
    });

    it("generates customer_id filter with langwatch.customer_id attribute key", () => {
      const builder = clickHouseFilterConditions["metadata.customer_id"];
      const result = builder!(["cust1"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['langwatch.customer_id'] IN ({f0_values:Array(String)})"
      );
    });
  });

  describe("metadata.key", () => {
    it("checks all three key formats for existence", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      expect(builder).not.toBeNull();
      const result = builder!(["canary"], "f0");
      expect(result.sql).toContain("f0_k0_canonical");
      expect(result.sql).toContain("f0_k0_lw");
      expect(result.sql).toContain("f0_k0_bare");
      expect(result.params).toEqual({
        f0_k0_canonical: "metadata.canary",
        f0_k0_lw: "langwatch.metadata.canary",
        f0_k0_bare: "canary",
      });
    });

    it("generates OR conditions for multiple keys", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!(["canary", "environment"], "f0");
      expect(result.sql).toContain(" OR ");
      expect(result.params).toHaveProperty("f0_k0_canonical", "metadata.canary");
      expect(result.params).toHaveProperty("f0_k1_canonical", "metadata.environment");
    });

    it("converts dot-encoded keys back to dots", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!(["nested·key"], "f0");
      expect(result.params).toHaveProperty("f0_k0_canonical", "metadata.nested.key");
      expect(result.params).toHaveProperty("f0_k0_bare", "nested.key");
    });

    it("returns 1=0 when no values", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!([], "f0");
      expect(result.sql).toBe("1=0");
    });
  });

  describe("metadata.value", () => {
    it("checks all three key formats for value match", () => {
      const builder = clickHouseFilterConditions["metadata.value"];
      expect(builder).not.toBeNull();
      const result = builder!(["true"], "f0", "canary");
      expect(result.sql).toContain("f0_canonical");
      expect(result.sql).toContain("f0_lw");
      expect(result.sql).toContain("f0_bare");
      expect(result.params).toEqual({
        f0_canonical: "metadata.canary",
        f0_lw: "langwatch.metadata.canary",
        f0_bare: "canary",
        f0_values: ["true"],
      });
    });

    it("returns 1=0 when key is missing", () => {
      const builder = clickHouseFilterConditions["metadata.value"];
      const result = builder!(["true"], "f0");
      expect(result.sql).toBe("1=0");
    });

    it("converts dot-encoded keys back to dots", () => {
      const builder = clickHouseFilterConditions["metadata.value"];
      const result = builder!(["val"], "f0", "nested·key");
      expect(result.params).toHaveProperty("f0_canonical", "metadata.nested.key");
      expect(result.params).toHaveProperty("f0_bare", "nested.key");
    });
  });

  describe("spans.type", () => {
    it("generates EXISTS subquery on stored_spans", () => {
      const builder = clickHouseFilterConditions["spans.type"];
      expect(builder).not.toBeNull();
      const result = builder!(["llm", "tool"], "f0");
      expect(result.sql).toContain("EXISTS (");
      expect(result.sql).toContain("stored_spans sp");
      expect(result.sql).toContain("sp.SpanAttributes['langwatch.span.type']");
      expect(result.params).toEqual({ f0_values: ["llm", "tool"] });
    });
  });

  describe("evaluations.evaluator_id.has_passed", () => {
    it("generates EXISTS subquery filtering on Passed IS NOT NULL", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_passed"];
      expect(builder).not.toBeNull();
      const result = builder!(["eval-1", "eval-2"], "f0");
      expect(result.sql).toContain("EXISTS (");
      expect(result.sql).toContain("es.EvaluatorId IN ({f0_values:Array(String)})");
      expect(result.sql).toContain("es.Passed IS NOT NULL");
      expect(result.params).toEqual({ f0_values: ["eval-1", "eval-2"] });
    });

    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_passed"];
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.evaluator_id.has_score", () => {
    it("generates EXISTS subquery filtering on Score IS NOT NULL", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_score"];
      expect(builder).not.toBeNull();
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("EXISTS (");
      expect(result.sql).toContain("es.EvaluatorId IN ({f0_values:Array(String)})");
      expect(result.sql).toContain("es.Score IS NOT NULL");
      expect(result.params).toEqual({ f0_values: ["eval-1"] });
    });

    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_score"];
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.evaluator_id.has_label", () => {
    it("generates EXISTS subquery filtering on Label IS NOT NULL and excludes succeeded/failed", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_label"];
      expect(builder).not.toBeNull();
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("EXISTS (");
      expect(result.sql).toContain("es.EvaluatorId IN ({f0_values:Array(String)})");
      expect(result.sql).toContain("es.Label IS NOT NULL");
      expect(result.sql).toContain("es.Label != ''");
      expect(result.sql).toContain("es.Label NOT IN ('succeeded', 'failed')");
      expect(result.params).toEqual({ f0_values: ["eval-1"] });
    });

    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.has_label"];
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.evaluator_id.guardrails_only", () => {
    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id.guardrails_only"];
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.evaluator_id (base)", () => {
    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.evaluator_id"];
      const result = builder!(["eval-1"], "f0");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.passed", () => {
    it("returns 1=0 when key is missing", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true"], "f0");
      expect(result.sql).toBe("1=0");
    });

    it("generates EXISTS subquery with key when provided", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true"], "f0", "evaluator-123");
      expect(result.sql).toContain("EXISTS (");
      expect(result.sql).toContain("es.EvaluatorId = {f0_key:String}");
      expect(result.params).toHaveProperty("f0_key", "evaluator-123");
    });

    it("converts true/false strings to 1/0", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true", "false"], "f0", "eval-1");
      expect(result.params.f0_values).toEqual([1, 0]);
    });

    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true"], "f0", "eval-1");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.score", () => {
    it("returns 1=0 when key is missing", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0", "1"], "f0");
      expect(result.sql).toBe("1=0");
    });

    it("returns 1=0 when values has less than 2 elements", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0"], "f0", "eval-1");
      expect(result.sql).toBe("1=0");
    });

    it("generates range condition with min and max", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0.5", "0.9"], "f0", "eval-1");
      expect(result.sql).toContain("es.Score >= {f0_min:Float64}");
      expect(result.sql).toContain("es.Score <= {f0_max:Float64}");
      expect(result.params.f0_min).toBe(0.5);
      expect(result.params.f0_max).toBe(0.9);
    });

    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0.5", "0.9"], "f0", "eval-1");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });

    it("returns no-match condition for invalid numeric values", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["invalid", "NaN"], "f0", "eval-1");
      expect(result.sql).toBe("1=0");
      expect(result.params).toEqual({});
    });

    it("returns no-match condition when min > max", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0.9", "0.5"], "f0", "eval-1");
      expect(result.sql).toBe("1=0");
      expect(result.params).toEqual({});
    });
  });

  describe("evaluations.state", () => {
    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.state"];
      const result = builder!(["processed"], "f0", "eval-1");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });

  describe("evaluations.label", () => {
    it("uses assumeNotNull for Nullable TraceId correlation (#3000)", () => {
      const builder = clickHouseFilterConditions["evaluations.label"];
      const result = builder!(["positive"], "f0", "eval-1");
      expect(result.sql).toContain("es.TraceId IS NOT NULL");
      expect(result.sql).toContain("assumeNotNull(es.TraceId) = ts.TraceId");
      expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId/);
    });
  });
});

describe("generateClickHouseFilterConditions", () => {
  it("returns empty conditions for empty filters", () => {
    const result = generateClickHouseFilterConditions({});
    expect(result.conditions).toEqual([]);
    expect(result.params).toEqual({});
    expect(result.hasUnsupportedFilters).toBe(false);
  });

  it("handles array filters", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "topics.topics": ["topic1", "topic2"],
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.conditions.length).toBe(1);
    expect(result.conditions[0]).toContain("ts.TopicId IN");
    expect(result.params).toHaveProperty("f0_values", ["topic1", "topic2"]);
  });

  it("handles multiple filters", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "topics.topics": ["topic1"],
      "spans.model": ["gpt-4"],
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.conditions.length).toBe(2);
    expect(result.hasUnsupportedFilters).toBe(false);
  });

  it("generates conditions for metadata.key filter", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.key": ["some-key"],
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.hasUnsupportedFilters).toBe(false);
    expect(result.conditions.length).toBe(1);
  });

  it("skips empty array filters", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "topics.topics": [],
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.conditions).toEqual([]);
  });

  it("handles nested filters (key -> values)", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "evaluations.passed": {
        "eval-1": ["true"],
        "eval-2": ["false"],
      },
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.conditions.length).toBe(1);
    expect(result.conditions[0]).toContain(" OR ");
    expect(Object.keys(result.params).length).toBeGreaterThan(0);
  });

  it("generates unique parameter names for multiple filters", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "topics.topics": ["topic1"],
      "topics.subtopics": ["subtopic1"],
    };
    const result = generateClickHouseFilterConditions(filters);
    const paramKeys = Object.keys(result.params);
    expect(paramKeys).toContain("f0_values");
    expect(paramKeys).toContain("f1_values");
  });

  describe("two-level nested filters", () => {
    it("handles key -> subkey -> values nesting", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "events.metrics.value": {
          purchase: {
            amount: ["0", "100"],
          },
        },
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.conditions.length).toBe(1);
      expect(result.params).toHaveProperty("f0_key", "purchase");
      expect(result.params).toHaveProperty("f0_attrkey", "event.metrics.amount");
      expect(result.params).toHaveProperty("f0_min");
      expect(result.params).toHaveProperty("f0_max");
    });

    it("handles multiple keys at same level", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "events.metrics.value": {
          purchase: {
            amount: ["0", "100"],
          },
          signup: {
            duration: ["0", "5000"],
          },
        },
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.conditions.length).toBe(1);
      expect(result.conditions[0]).toContain(" OR ");
      // Should have params for both nested conditions
      expect(
        Object.keys(result.params).filter((k) => k.includes("_key")).length,
      ).toBe(2);
    });

    it("handles single nested condition without wrapping in extra parens", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "evaluations.score": {
          "eval-1": ["0.5", "0.9"],
        },
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.conditions.length).toBe(1);
      // Single condition should not have extra OR wrapping
      expect(result.conditions[0]).not.toContain(" OR ");
    });
  });
});
