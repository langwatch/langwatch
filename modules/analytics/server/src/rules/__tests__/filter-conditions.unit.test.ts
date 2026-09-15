/**
 * clickHouseFilterConditions builders that translate a filter field's selected
 * values into raw ClickHouse SQL fragments, and generateClickHouseFilterConditions
 * that composes them for a whole filter set.
 * Spec: specs/traces/saved-views.feature, modules/analytics/specs/filter-sql-generation.feature
 */
import { describe, expect, it } from "vitest";
import {
  clickHouseFilterConditions,
  generateClickHouseFilterConditions,
} from "../analytics-filter-conditions.rules.ts";
import type { FilterField } from "@langwatch/analytics-contract";
import type { AnalyticsFilterValue as FilterParam } from "@langwatch/analytics-contract";

describe("clickHouseFilterConditions", () => {
  describe("given a filter field backed by one trace_summaries column", () => {
    /** @scenario 'A single-valued attribute filter becomes ts.<column> IN (...)' */
    it.each([
      ["topics.topics", "ts.TopicId"],
      ["topics.subtopics", "ts.SubTopicId"],
      ["metadata.user_id", "ts.Attributes['langwatch.user_id']"],
      ["metadata.thread_id", "ts.Attributes['gen_ai.conversation.id']"],
      ["metadata.customer_id", "ts.Attributes['langwatch.customer_id']"],
      ["traces.name", "ts.TraceName"],
    ] as const)("when %s is filtered, it binds an IN clause against %s", (field, column) => {
      const builder = clickHouseFilterConditions[field];
      expect(builder).not.toBeNull();

      const result = builder!(["v1", "v2"], "f0");

      expect(result.sql).toBe(`${column} IN ({f0_values:Array(String)})`);
      expect(result.params).toEqual({ f0_values: ["v1", "v2"] });
    });
  });

  describe("given a filter field backed by a JSON or array-typed attribute", () => {
    /** @scenario 'A list-valued attribute filter becomes hasAny(...)' */
    it.each([
      ["metadata.labels", "ts.Attributes['langwatch.labels']"],
      ["metadata.prompt_ids", "ts.Attributes['langwatch.prompt_ids']"],
      ["spans.model", "ts.Models"],
    ] as const)("when %s is filtered, it checks set membership via hasAny", (field, attr) => {
      const builder = clickHouseFilterConditions[field];
      expect(builder).not.toBeNull();

      const result = builder!(["a", "b"], "f0");

      expect(result.sql).toContain("hasAny(");
      expect(result.sql).not.toContain('"a"');
      expect(result.sql).not.toContain('"b"');
      if (field === "spans.model") {
        expect(result.sql).toBe(`hasAny(${attr}, {f0_values:Array(String)})`);
      } else {
        expect(result.sql).toContain(attr);
      }
      expect(result.params).toEqual({ f0_values: ["a", "b"] });
    });
  });

  describe("given metadata.key filters, possibly dot-encoded", () => {
    /** @scenario 'A metadata key filter checks the canonical, legacy, and bare attribute names' */
    it("when a single key is filtered, it checks all three historical key formats", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!(["nested·key"], "f0");

      expect(result.params).toEqual({
        f0_k0_canonical: "metadata.nested.key",
        f0_k0_lw: "langwatch.metadata.nested.key",
        f0_k0_bare: "nested.key",
      });
      expect(result.sql).toContain("f0_k0_canonical");
      expect(result.sql).toContain("f0_k0_lw");
      expect(result.sql).toContain("f0_k0_bare");
    });

    it("when several keys are filtered, it OR's each key's three-format check together", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!(["canary", "environment"], "f0");

      expect(result.sql).toContain(" OR ");
      expect(result.params).toHaveProperty("f0_k0_canonical", "metadata.canary");
      expect(result.params).toHaveProperty("f0_k1_canonical", "metadata.environment");
    });

    it("when no keys are selected, it returns the no-match guard", () => {
      const builder = clickHouseFilterConditions["metadata.key"];
      const result = builder!([], "f0");

      expect(result.sql).toBe("1=0");
      expect(result.params).toEqual({});
    });
  });

  describe("given a metadata.value filter with no key", () => {
    /** @scenario 'A metadata value filter requires its key' */
    it("when the key is missing, it returns the no-match guard rather than an unresolvable column", () => {
      const builder = clickHouseFilterConditions["metadata.value"];
      const result = builder!(["true"], "f0");

      expect(result.sql).toBe("1=0");
      expect(result.params).toEqual({});
    });

    it("when the key is present, it checks all three historical key formats for the value", () => {
      const builder = clickHouseFilterConditions["metadata.value"];
      const result = builder!(["val"], "f0", "nested·key");

      expect(result.params).toEqual({
        f0_canonical: "metadata.nested.key",
        f0_lw: "langwatch.metadata.nested.key",
        f0_bare: "nested.key",
        f0_values: ["val"],
      });
    });
  });

  describe("given a boolean-backed filter field with true and/or false selected", () => {
    /** @scenario 'Selecting only true, only false, both, or neither yields the matching predicate' */
    it.each([
      ["traces.error", ["true"], "ts.ContainsErrorStatus = true"],
      ["traces.error", ["false"], "ts.ContainsErrorStatus = false"],
      ["traces.error", ["true", "false"], "1=1"],
      ["traces.error", [], "1=0"],
      ["annotations.hasAnnotation", ["true"], "ts.HasAnnotation = true"],
      [
        "annotations.hasAnnotation",
        ["false"],
        "(ts.HasAnnotation = false OR ts.HasAnnotation IS NULL)",
      ],
      ["annotations.hasAnnotation", ["true", "false"], "1=1"],
      ["annotations.hasAnnotation", [], "1=0"],
    ] as const)("when %s selects %j, it emits %s", (field, values, expectedSql) => {
      const builder = clickHouseFilterConditions[field];
      const result = builder!([...values], "f0");

      expect(result.sql).toBe(expectedSql);
      expect(result.params).toEqual({});
    });
  });

  describe("given traces.origin, which maps empty/NULL to 'application'", () => {
    const expectedSql =
      "if(ifNull(ts.Attributes['langwatch.origin'], '') = '', 'application', ts.Attributes['langwatch.origin']) IN ({f0_values:Array(String)})";

    /** @scenario 'ClickHouse origin aggregation labels empty values as "application"' */
    it("maps empty/NULL origins to 'application' via ifNull, matching the dropdown", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      expect(builder).not.toBeNull();
      const result = builder!(["application"], "f0");
      expect(result.sql).toBe(expectedSql);
      expect(result.params).toEqual({ f0_values: ["application"] });
    });

    it("passes non-application values through directly", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!(["evaluation"], "f0");
      expect(result.sql).toBe(expectedSql);
    });

    it("returns 1=0 when no values selected", () => {
      const builder = clickHouseFilterConditions["traces.origin"];
      const result = builder!([], "f0");
      expect(result.sql).toBe("1=0");
    });
  });

  describe("given a filter field that correlates against evaluation_runs", () => {
    /** @scenario 'An evaluator-scoped filter joins on TenantId before the NULL-safe TraceId match' */
    it.each([
      "evaluations.evaluator_id",
      "evaluations.evaluator_id.guardrails_only",
      "evaluations.evaluator_id.has_passed",
      "evaluations.evaluator_id.has_score",
      "evaluations.evaluator_id.has_label",
    ] as const)(
      "when %s runs, TenantId is checked before the NULL-safe TraceId correlation",
      (field) => {
        const builder = clickHouseFilterConditions[field];
        expect(builder).not.toBeNull();
        const result = builder!(["eval-1"], "f0");

        expect(result.sql).toContain("EXISTS (");
        const whereClause = result.sql.slice(result.sql.indexOf("WHERE"));
        const tenantIndex = whereClause.indexOf("es.TenantId = ts.TenantId");
        const traceIdIndex = whereClause.indexOf("assumeNotNull(es.TraceId) = ts.TraceId");
        expect(tenantIndex).toBeGreaterThanOrEqual(0);
        expect(traceIdIndex).toBeGreaterThan(tenantIndex);
        expect(result.sql).toContain("es.TraceId IS NOT NULL");
        expect(result.sql).not.toMatch(/es\.TraceId = ts\.TraceId(?!\)| IS)/);
      },
    );

    it.each([
      ["evaluations.passed", ["true"], "eval-1"],
      ["evaluations.state", ["processed"], "eval-1"],
      ["evaluations.label", ["positive"], "eval-1"],
    ] as const)(
      "when %s runs with a key, TenantId is checked before the NULL-safe TraceId correlation",
      (field, values, key) => {
        const builder = clickHouseFilterConditions[field];
        const result = builder!([...values], "f0", key);

        const whereClause = result.sql.slice(result.sql.indexOf("WHERE"));
        const tenantIndex = whereClause.indexOf("es.TenantId = ts.TenantId");
        const traceIdIndex = whereClause.indexOf("assumeNotNull(es.TraceId) = ts.TraceId");
        expect(tenantIndex).toBeGreaterThanOrEqual(0);
        expect(traceIdIndex).toBeGreaterThan(tenantIndex);
      },
    );

    it("when evaluations.passed has no key, it returns the no-match guard", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true"], "f0");
      expect(result.sql).toBe("1=0");
    });

    it("when evaluations.passed selects true/false, it coerces them to 1/0 for the ClickHouse column", () => {
      const builder = clickHouseFilterConditions["evaluations.passed"];
      const result = builder!(["true", "false"], "f0", "eval-1");
      expect(result.params.f0_values).toEqual([1, 0]);
    });
  });

  describe("given an evaluation score or event-metric range filter", () => {
    /** @scenario 'A numeric evaluation range filter rejects invalid or inverted ranges' */
    it.each([
      ["evaluations.score", [], undefined],
      ["evaluations.score", ["0"], "eval-1"],
      ["evaluations.score", ["invalid", "NaN"], "eval-1"],
      ["evaluations.score", ["0.9", "0.5"], "eval-1"],
    ] as const)(
      "when evaluations.score is given %j with key=%s, it returns the no-match guard",
      (field, values, key) => {
        const builder = clickHouseFilterConditions[field];
        const result = key ? builder!([...values], "f0", key) : builder!([...values], "f0");
        expect(result.sql).toBe("1=0");
        expect(result.params).toEqual({});
      },
    );

    it("when evaluations.score is given a valid ascending range, it emits a bounded comparison", () => {
      const builder = clickHouseFilterConditions["evaluations.score"];
      const result = builder!(["0.5", "0.9"], "f0", "eval-1");
      expect(result.sql).toContain("es.Score >= {f0_min:Float64}");
      expect(result.sql).toContain("es.Score <= {f0_max:Float64}");
      expect(result.params.f0_min).toBe(0.5);
      expect(result.params.f0_max).toBe(0.9);
    });

    it("when events.metrics.value is given an invalid range, it returns the no-match guard", () => {
      const builder = clickHouseFilterConditions["events.metrics.value"];
      const result = builder!(["100", "0"], "f0", "purchase", "amount");
      expect(result.sql).toBe("1=0");
    });

    it("when events.metrics.value is given a valid range, it emits a bounded comparison", () => {
      const builder = clickHouseFilterConditions["events.metrics.value"];
      const result = builder!(["0", "100"], "f0", "purchase", "amount");
      expect(result.sql).toContain(
        "toFloat64OrNull(sp.SpanAttributes[{f0_attrkey:String}]) >= {f0_min:Float64}",
      );
      expect(result.params.f0_attrkey).toBe("event.metrics.amount");
    });
  });

  describe("given a filter value containing characters that would matter to a SQL parser", () => {
    /** @scenario 'A value containing SQL metacharacters never appears in the generated SQL text' */
    it("when topics.topics is filtered with a hostile value, the SQL text is unchanged by its contents", () => {
      const hostileValue = 'it\'s a "test"; DROP TABLE trace_summaries;--';
      const builder = clickHouseFilterConditions["topics.topics"];
      const result = builder!([hostileValue], "f0");

      expect(result.sql).not.toContain(hostileValue);
      expect(result.params).toEqual({ f0_values: [hostileValue] });
    });

    it("when evaluations.state is filtered with a hostile value, the SQL text is unchanged by its contents", () => {
      const hostileValue = "'; DROP TABLE evaluation_runs;--";
      const builder = clickHouseFilterConditions["evaluations.state"];
      const result = builder!([hostileValue], "f0", "eval-1");

      expect(result.sql).not.toContain(hostileValue);
      expect(result.params).toEqual({ f0_key: "eval-1", f0_values: [hostileValue] });
    });
  });
});

describe("generateClickHouseFilterConditions", () => {
  describe("given no filters are selected", () => {
    /** @scenario 'An empty filter set produces no conditions' */
    it("produces no conditions and no parameters", () => {
      const result = generateClickHouseFilterConditions({});
      expect(result.conditions).toEqual([]);
      expect(result.params).toEqual({});
      expect(result.hasUnsupportedFilters).toBe(false);
    });

    it("skips a filter field whose selection is empty", () => {
      const result = generateClickHouseFilterConditions({ "topics.topics": [] });
      expect(result.conditions).toEqual([]);
    });
  });

  describe("given a filter field with no registered condition builder", () => {
    /** @scenario 'A field with no condition builder is flagged unsupported and contributes no condition' */
    it("flags hasUnsupportedFilters and emits no condition for that field", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        ["some.stale_field" as FilterField]: ["value1"],
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.hasUnsupportedFilters).toBe(true);
      expect(result.conditions).toEqual([]);
      expect(result.params).toEqual({});
    });

    /** @scenario 'An unsupported field does not suppress a supported field alongside it' */
    it("when a supported field is selected alongside it, the supported field's condition still emits", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "topics.topics": ["topic1"],
        ["some.stale_field" as FilterField]: ["value1"],
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.hasUnsupportedFilters).toBe(true);
      expect(result.conditions.length).toBe(1);
      expect(result.conditions[0]).toContain("ts.TopicId IN");
    });
  });

  describe("given a filter field with multiple keys, each with its own values", () => {
    /** @scenario 'Nested key-scoped filters are combined with OR without a redundant wrapping paren' */
    it("when a single key is nested, it emits the condition without extra wrapping parens", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "evaluations.score": { "eval-1": ["0.5", "0.9"] },
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.conditions.length).toBe(1);
      expect(result.conditions[0]).not.toContain(" OR ");
    });

    it("when several keys are nested, it OR's their conditions together", () => {
      const filters: Partial<Record<FilterField, FilterParam>> = {
        "events.metrics.value": {
          purchase: { amount: ["0", "100"] },
          signup: { duration: ["0", "5000"] },
        },
      };
      const result = generateClickHouseFilterConditions(filters);

      expect(result.conditions.length).toBe(1);
      expect(result.conditions[0]).toContain(" OR ");
    });
  });

  describe("given more than one filter field is selected", () => {
    /** @scenario 'Each filter field receives its own uniquely numbered parameter id' */
    it("assigns each field a distinct, incrementing parameter id", () => {
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

  describe("given a filter set containing a field that probes stored_spans", () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** @scenario 'A span- or event-probing filter carries a partition-key range when a time window is given' */
    it.each([
      ["spans.type", ["llm"]],
      ["events.event_type", ["thumbs_up"]],
    ] as const)(
      "when %s is filtered with a dashboard time window, StartTime is bounded and clamped at zero",
      (field, values) => {
        const startDate = 10 * DAY;
        const endDate = 20 * DAY;
        const result = generateClickHouseFilterConditions(
          { [field]: [...values] } as Partial<Record<FilterField, FilterParam>>,
          { startDate, endDate },
        );

        expect(result.conditions[0]).toContain("sp.StartTime >=");
        expect(result.conditions[0]).toContain("sp.StartTime <=");
        expect(result.params).toHaveProperty("spanWindowStart", startDate - 2 * DAY);
        expect(result.params).toHaveProperty("spanWindowEnd", endDate + 2 * DAY);
      },
    );

    it("clamps the lower bound at zero when the window starts before the epoch buffer allows", () => {
      const result = generateClickHouseFilterConditions(
        { "spans.type": ["llm"] },
        { startDate: 0, endDate: 5 * DAY },
      );
      expect(result.params).toHaveProperty("spanWindowStart", 0);
    });

    /** @scenario 'A span- or event-probing filter stays unbounded without a time window' */
    it("when no time window is given, the stored_spans EXISTS subquery carries no StartTime predicate", () => {
      const result = generateClickHouseFilterConditions({ "spans.type": ["llm"] });
      expect(result.conditions[0]).not.toContain("sp.StartTime");
      expect(result.params).not.toHaveProperty("spanWindowStart");
    });

    it("does not inject a StartTime predicate for a filter set with no span probe", () => {
      const result = generateClickHouseFilterConditions(
        { "topics.topics": ["t1"] },
        { startDate: 10 * DAY, endDate: 20 * DAY },
      );
      expect(result.conditions[0]).not.toContain("sp.StartTime");
    });
  });
});
