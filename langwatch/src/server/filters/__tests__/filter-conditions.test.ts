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

  describe("metadata filters", () => {
    it("generates user_id filter with correct attribute path", () => {
      const builder = clickHouseFilterConditions["metadata.user_id"];
      const result = builder!(["user1"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['user.id'] IN ({f0_values:Array(String)})"
      );
    });

    it("generates thread_id filter with correct attribute path", () => {
      const builder = clickHouseFilterConditions["metadata.thread_id"];
      const result = builder!(["thread1"], "f0");
      expect(result.sql).toBe(
        "ts.Attributes['thread.id'] IN ({f0_values:Array(String)})"
      );
    });
  });

  describe("unsupported filters", () => {
    it("returns null for metadata.key filter", () => {
      expect(clickHouseFilterConditions["metadata.key"]).toBeNull();
    });

    it("returns null for metadata.value filter", () => {
      expect(clickHouseFilterConditions["metadata.value"]).toBeNull();
    });

    it("returns null for spans.type filter (requires join)", () => {
      expect(clickHouseFilterConditions["spans.type"]).toBeNull();
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

    it("uses safe defaults for invalid numeric values", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["invalid", "NaN"], "f0", "eval-1");
      expect(result.params.f0_min).toBe(0);
      expect(result.params.f0_max).toBe(1);
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

  it("sets hasUnsupportedFilters when unsupported filter is included", () => {
    const filters: Partial<Record<FilterField, FilterParam>> = {
      "metadata.key": ["some-key"],
    };
    const result = generateClickHouseFilterConditions(filters);
    expect(result.hasUnsupportedFilters).toBe(true);
    expect(result.conditions).toEqual([]);
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
});
