/**
 * `legacyTraceFilterTerms` turns a legacy `filters` document into builder conditions over
 * `trace_summaries`; each is rendered here into the read it narrows.
 * Spec: modules/trace/specs/legacy-filter-sql-generation.feature
 */
import {
  clickhouseRead,
  tenantScope,
  type ReaderScope,
} from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaries } from "../../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import {
  legacyTraceFilterTerms,
  type LegacySpanWindow,
} from "../clickhouse.trace-legacy-filter-condition.mapper.ts";

const DAY = 24 * 60 * 60 * 1000;
const SINGLE = tenantScope.single({ tenantId: "project-1" });

/** The filters compiled for `scope`, rendered as the WHERE of one summary read. */
function rendered(
  filters: Record<string, unknown>,
  { window, scope = SINGLE }: { window?: LegacySpanWindow; scope?: ReaderScope } = {},
) {
  const { terms, hasUnsupportedFilters } = legacyTraceFilterTerms({ filters, window, scope });
  const statement = clickhouseRead({ scope: SINGLE })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .where((ops) => (terms.length === 0 ? ops.and() : ops.and(...terms.map((term) => term(ops)))))
    .build();
  const where = statement.sql.slice(statement.sql.indexOf("WHERE TenantId = {tenantId:String}"));
  const { tenantId: _tenant, ...params } = statement.params;
  return { terms, hasUnsupportedFilters, where, params, values: Object.values(params) };
}

/** The value bound by the `{name:Type}` the pattern's one capture group finds. */
function boundAt(result: ReturnType<typeof rendered>, pattern: RegExp): unknown {
  const name = pattern.exec(result.where)?.[1];
  return name === undefined ? undefined : result.params[name];
}

describe("legacyTraceFilterTerms", () => {
  describe("given a filter field backed by one trace_summaries column", () => {
    /** @scenario 'A single-valued attribute filter becomes <column> IN (...)' */
    it.each([
      ["topics.topics", "TopicId", undefined],
      ["topics.subtopics", "SubTopicId", undefined],
      ["metadata.user_id", "Attributes[{v0:String}]", "langwatch.user_id"],
      ["metadata.thread_id", "Attributes[{v0:String}]", "gen_ai.conversation.id"],
      ["metadata.customer_id", "Attributes[{v0:String}]", "langwatch.customer_id"],
      ["traces.name", "TraceName", undefined],
    ] as const)("when %s is filtered, it binds an IN clause against %s", (field, column, key) => {
      const result = rendered({ [field]: ["v1", "v2"] });

      expect(result.where).toMatch(
        new RegExp(
          `\\(${column.replace(/[[\]{}()]/g, "\\$&")} IN \\(\\{v\\d:Array\\(String\\)\\}\\)\\)$`,
        ),
      );
      expect(result.values).toEqual(key ? [key, ["v1", "v2"]] : [["v1", "v2"]]);
    });
  });

  describe("given a filter field backed by a JSON or array-typed attribute", () => {
    /** @scenario 'A list-valued attribute filter becomes hasAny(...)' */
    it.each([
      ["metadata.labels", "langwatch.labels"],
      ["metadata.prompt_ids", "langwatch.prompt_ids"],
    ] as const)("when %s is filtered, it checks set membership via hasAny", (field, attribute) => {
      const result = rendered({ [field]: ["a", "b"] });

      expect(result.where).toContain("hasAny(JSONExtractArrayRaw(Attributes[{v0:String}]), {v1:");
      expect(result.where).not.toContain('"a"');
      // Bound JSON-quoted, as main's `concat('"', x, '"')` compared the raw array elements.
      expect(result.values).toEqual([attribute, ['"a"', '"b"']]);
    });

    it("when spans.model is filtered, it checks set membership of the span models via hasAny", () => {
      const result = rendered({ "spans.model": ["a", "b"] });

      expect(result.where).toContain("hasAny(Models, {v0:Array(String)})");
      expect(result.values).toEqual([["a", "b"]]);
    });
  });

  describe("given metadata.key filters, possibly dot-encoded", () => {
    /** @scenario 'A metadata key filter checks the canonical, legacy, and bare attribute names' */
    it("when a single key is filtered, it checks all three historical key formats", () => {
      const result = rendered({ "metadata.key": ["nested·key"] });

      for (const stored of ["metadata.nested.key", "langwatch.metadata.nested.key", "nested.key"]) {
        expect(result.values).toContain(stored);
      }
      expect(result.where.match(/mapContains\(Attributes, /g)).toHaveLength(3);
      expect(result.where.match(/ OR /g)).toHaveLength(2);
    });

    it("when several keys are filtered, it ORs each key's three-format check together", () => {
      const result = rendered({ "metadata.key": ["canary", "environment"] });

      expect(result.values).toContain("metadata.canary");
      expect(result.values).toContain("metadata.environment");
      expect(result.where.match(/mapContains\(Attributes, /g)).toHaveLength(6);
      expect(result.where).toContain(") OR ((mapContains");
    });
  });

  describe("given a metadata.value filter with no key", () => {
    /** @scenario 'A metadata value filter requires its key' */
    it("when the key is missing, it matches nothing rather than an unresolvable column", () => {
      const result = rendered({ "metadata.value": ["true"] });

      expect(result.where).toMatch(/\(0 = 1\)$/);
      expect(result.params).toEqual({});
    });

    it("when the key is present, it checks all three historical key formats for the value", () => {
      const result = rendered({ "metadata.value": { nested·key: ["val"] } });

      expect(result.values).toEqual([
        "metadata.nested.key",
        ["val"],
        "langwatch.metadata.nested.key",
        ["val"],
        "nested.key",
        ["val"],
      ]);
    });
  });

  describe("given a boolean-backed filter field with true and/or false selected", () => {
    /** @scenario 'Selecting only true, only false, both, or neither yields the matching predicate' */
    it.each([
      ["traces.error", ["true"], "(ContainsErrorStatus = {v0:Bool})", [true]],
      ["traces.error", ["false"], "(ContainsErrorStatus = {v0:Bool})", [false]],
      ["traces.error", ["true", "false"], "(1 = 1)", []],
      ["annotations.hasAnnotation", ["true"], "(HasAnnotation = {v0:Bool})", [true]],
      [
        "annotations.hasAnnotation",
        ["false"],
        "((HasAnnotation = {v0:Bool} OR HasAnnotation IS NULL))",
        [false],
      ],
      ["annotations.hasAnnotation", ["true", "false"], "(1 = 1)", []],
    ] as const)("when %s selects %j, it emits %s", (field, values, expected, bound) => {
      const result = rendered({ [field]: [...values] });

      expect(result.where.endsWith(` AND ${expected}`)).toBe(true);
      expect(result.values).toEqual(bound);
    });

    it("when neither is selected, the field narrows nothing, as main skipped an empty selection", () => {
      expect(rendered({ "traces.error": [] }).terms).toEqual([]);
    });
  });

  describe("given traces.origin, which maps empty or NULL to 'application'", () => {
    /** @scenario 'ClickHouse origin aggregation labels empty values as "application"' */
    it("maps empty or NULL origins to 'application' via ifNull, matching the dropdown", () => {
      const result = rendered({ "traces.origin": ["application"] });

      expect(result.where).toContain(
        "if(ifNull(Attributes[{v0:String}], {v1:String}) != {v2:String}, Attributes[{v0:String}], {v3:String}) IN ({v4:Array(String)})",
      );
      expect(result.params).toEqual({
        v0: "langwatch.origin",
        v1: "",
        v2: "",
        v3: "application",
        v4: ["application"],
      });
    });
  });

  describe("given a filter field that correlates against evaluation_runs", () => {
    /** @scenario 'An evaluator-scoped filter matches a trace by its tenant and id in evaluation_runs' */
    it.each([
      [{ "evaluations.evaluator_id": ["eval-1"] }],
      [{ "evaluations.evaluator_id.guardrails_only": ["eval-1"] }],
      [{ "evaluations.evaluator_id.has_passed": ["eval-1"] }],
      [{ "evaluations.evaluator_id.has_score": ["eval-1"] }],
      [{ "evaluations.evaluator_id.has_label": ["eval-1"] }],
      [{ "evaluations.passed": { "eval-1": ["true"] } }],
      [{ "evaluations.state": { "eval-1": ["processed"] } }],
      [{ "evaluations.label": { "eval-1": ["positive"] } }],
    ])("when %j runs, the trace's (TenantId, TraceId) is in the read's own runs", (filters) => {
      const result = rendered(filters);

      expect(result.where).toContain(
        "tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND ",
      );
      expect(JSON.stringify(result.values)).toContain('"eval-1"');
    });

    it("when evaluations.passed has no key, it matches nothing", () => {
      expect(rendered({ "evaluations.passed": ["true"] }).where).toMatch(/\(0 = 1\)$/);
    });

    it("when evaluations.passed selects true and false, it coerces them to 1 and 0", () => {
      const result = rendered({ "evaluations.passed": { "eval-1": ["true", "false"] } });

      expect(result.where).toContain("Passed IN ({v1:Array(UInt8)})");
      expect(result.params.v1).toEqual([1, 0]);
    });
  });

  describe("given an evaluation score or event-metric range filter", () => {
    /** @scenario 'A numeric evaluation range filter rejects invalid or inverted ranges' */
    it.each([
      [{ "evaluations.score": [] }],
      [{ "evaluations.score": { "eval-1": ["0"] } }],
      [{ "evaluations.score": { "eval-1": ["invalid", "NaN"] } }],
      [{ "evaluations.score": { "eval-1": ["0.9", "0.5"] } }],
      [{ "events.metrics.value": { purchase: { amount: ["100", "0"] } } }],
    ])("when given %j, it matches nothing", (filters) => {
      const result = rendered(filters);

      expect(result.where).not.toContain("Score");
      expect(result.params).toEqual({});
    });

    it("when evaluations.score is given a valid ascending range, it emits a bounded comparison", () => {
      const result = rendered({ "evaluations.score": { "eval-1": ["0.5", "0.9"] } });

      expect(boundAt(result, /Score >= \{(\w+):Float64\}/)).toBe(0.5);
      expect(boundAt(result, /Score <= \{(\w+):Float64\}/)).toBe(0.9);
    });

    it("when events.metrics.value is given a valid range, it emits a bounded comparison", () => {
      const result = rendered({ "events.metrics.value": { purchase: { amount: ["0", "100"] } } });

      const attribute =
        /toFloat64OrNull\(SpanAttributes\[\{(\w+):String\}\]\) >= \{(\w+):Float64\}/.exec(
          result.where,
        );
      expect(result.params[attribute![1]!]).toBe("event.metrics.amount");
      expect(result.params[attribute![2]!]).toBe(0);
    });
  });

  describe("given a filter value containing characters that would matter to a SQL parser", () => {
    /** @scenario 'A value containing SQL metacharacters never appears in the generated SQL text' */
    it.each([
      [{ "topics.topics": ['it\'s a "test"; DROP TABLE trace_summaries;--'] }],
      [{ "evaluations.state": { "eval-1": ["'; DROP TABLE evaluation_runs;--"] } }],
    ])("when %j is filtered, the SQL text is unchanged by its contents", (filters) => {
      const hostile = JSON.stringify(filters).includes("trace_summaries;")
        ? 'it\'s a "test"; DROP TABLE trace_summaries;--'
        : "'; DROP TABLE evaluation_runs;--";
      const result = rendered(filters);
      const benign = rendered(JSON.parse(JSON.stringify(filters).replace(/DROP[^"\\]*/g, "x")));

      expect(result.where).not.toContain("DROP");
      expect(result.where).toBe(benign.where);
      expect(result.values).toContainEqual([hostile]);
    });
  });

  describe("given no filters are selected", () => {
    /** @scenario 'An empty filter set produces no conditions' */
    it("produces no terms", () => {
      expect(legacyTraceFilterTerms({ filters: {}, scope: SINGLE })).toEqual({
        terms: [],
        hasUnsupportedFilters: false,
      });
    });

    it("skips a filter field whose selection is empty", () => {
      expect(rendered({ "topics.topics": [] }).terms).toEqual([]);
    });
  });

  describe("given a filter field with no condition builder", () => {
    /** @scenario 'A field with no condition builder is flagged unsupported and contributes no condition' */
    it("flags hasUnsupportedFilters and emits no term for that field", () => {
      const result = rendered({ "some.stale_field": ["value1"] });

      expect(result.hasUnsupportedFilters).toBe(true);
      expect(result.terms).toEqual([]);
    });

    /** @scenario 'An unsupported field does not suppress a supported field alongside it' */
    it("when a supported field is selected alongside it, the supported field's term still emits", () => {
      const result = rendered({ "topics.topics": ["topic1"], "some.stale_field": ["value1"] });

      expect(result.hasUnsupportedFilters).toBe(true);
      expect(result.terms).toHaveLength(1);
      expect(result.where).toContain("TopicId IN");
    });
  });

  describe("given a filter field with multiple keys, each with its own values", () => {
    /** @scenario 'Nested key-scoped filters are combined with OR' */
    it("when a single key is nested, it emits that key's condition alone", () => {
      const result = rendered({ "evaluations.score": { "eval-1": ["0.5", "0.9"] } });

      expect(result.terms).toHaveLength(1);
      expect(result.where).not.toContain(" OR ");
    });

    it("when several keys are nested, it ORs their conditions together", () => {
      const result = rendered({
        "events.metrics.value": {
          purchase: { amount: ["0", "100"] },
          signup: { duration: ["0", "5000"] },
        },
      });

      expect(result.terms).toHaveLength(1);
      expect(result.where).toContain(")) OR tuple(TenantId, TraceId) IN (SELECT");
      expect(result.values).toEqual(expect.arrayContaining(["purchase", "signup"]));
    });
  });

  describe("given more than one filter field is selected", () => {
    /** @scenario 'Each filter field binds its own parameters' */
    it("binds each field's values under a distinct parameter, ANDed", () => {
      const result = rendered({ "topics.topics": ["topic1"], "topics.subtopics": ["subtopic1"] });

      const topic = boundAt(result, /TopicId IN \(\{(\w+):Array\(String\)\}\)/);
      const subtopic = boundAt(result, /SubTopicId IN \(\{(\w+):Array\(String\)\}\)/);
      expect([topic, subtopic]).toEqual([["topic1"], ["subtopic1"]]);
      expect(result.where).toMatch(/TopicId IN \(\{v0:Array\(String\)\}\) AND SubTopicId IN/);
    });
  });

  describe("given a filter set containing a field that probes stored_spans", () => {
    /** @scenario 'A span- or event-probing filter carries a partition-key range when a time window is given' */
    it.each([[{ "spans.type": ["llm"] }], [{ "events.event_type": ["thumbs_up"] }]])(
      "when %j is filtered in a window, StartTime is bounded two days wider",
      (filters) => {
        const result = rendered(filters, { window: { startDate: 10 * DAY, endDate: 20 * DAY } });

        expect(result.where).toContain("FROM stored_spans WHERE TenantId = {tenantId:String}");
        expect(boundAt(result, /StartTime >= fromUnixTimestamp64Milli\(\{(\w+):Int64\}\)/)).toBe(
          8 * DAY,
        );
        expect(boundAt(result, /StartTime <= fromUnixTimestamp64Milli\(\{(\w+):Int64\}\)/)).toBe(
          22 * DAY,
        );
      },
    );

    it("clamps the lower bound at zero when the window starts within the buffer", () => {
      const result = rendered({ "spans.type": ["llm"] }, { window: { startDate: 0, endDate: 5 } });

      expect(boundAt(result, /StartTime >= fromUnixTimestamp64Milli\(\{(\w+):Int64\}\)/)).toBe(0);
    });

    /** @scenario 'A span- or event-probing filter stays unbounded without a time window' */
    it("when no time window is given, the stored_spans subquery carries no StartTime predicate", () => {
      const result = rendered({ "spans.type": ["llm"] });

      expect(result.where).toContain("FROM stored_spans");
      expect(result.where).not.toContain("StartTime");
    });

    it("reads the span subquery under the read's own proof, never a bare tenant parameter", () => {
      const scope = tenantScope.fromProof({
        authorization: ownProof({ projectId: "project-1" }),
        reads: "traces",
      });
      const { terms } = legacyTraceFilterTerms({ filters: { "spans.type": ["llm"] }, scope });
      const statement = clickhouseRead({ scope })
        .from(traceSummaries)
        .withinWindows()
        .select({ TraceId: traceSummaries.TraceId })
        .where((ops) => terms[0]!(ops))
        .build();
      const subquery = statement.sql.slice(statement.sql.indexOf("FROM stored_spans"));

      expect(subquery).toMatch(
        /^FROM stored_spans WHERE \(TenantId IN \(\{(\w+):Array\(String\)\}\)\)/,
      );
      expect(statement.sql).not.toContain("{tenantId:String}");
    });
  });
});
