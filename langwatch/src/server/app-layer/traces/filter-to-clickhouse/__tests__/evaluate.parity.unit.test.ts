import { describe, expect, it } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import { FilterFieldUnknownError } from "../../errors";
import {
  type ExpressionCategoricalDef,
  FACET_REGISTRY,
  type RangeFacetDef,
} from "../../facet-registry";
import type { TraceSummaryData } from "../../types";
import { translateFilterToClickHouse } from "../ast";
import { evaluateQueryInMemory, queryNeeds } from "../evaluate";
import { type InMemoryTrace, UNSUPPORTED } from "../field-def";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseSummary: TraceSummaryData = {
  traceId: "trace-1",
  spanCount: 3,
  totalDurationMs: 1000,
  computedIOSchemaVersion: "1",
  computedInput: null,
  computedOutput: null,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "",
  occurredAt: 0,
  createdAt: 0,
  updatedAt: 0,
  LastEventOccurredAt: 0,
};

function makeTrace(
  summary: Partial<TraceSummaryData> = {},
  aux: Omit<InMemoryTrace, "summary"> = {},
): InMemoryTrace {
  return { summary: { ...baseSummary, ...summary }, ...aux };
}

function makeEval(over: Partial<EvaluationRunData> = {}): EvaluationRunData {
  return {
    evaluationId: "e1",
    evaluatorId: "ev1",
    evaluatorType: "custom",
    evaluatorName: null,
    traceId: "trace-1",
    isGuardrail: false,
    status: "processed",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
    archivedAt: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    costId: null,
    ...over,
  };
}

function makeEvent(over: Partial<DerivedTraceEvent> = {}): DerivedTraceEvent {
  return { spanId: "s1", timestamp: 0, name: "evt", attributes: {}, ...over };
}

// ---------------------------------------------------------------------------
// Parity table
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  query: string;
  trace: InMemoryTrace;
  expected: boolean;
}

const cases: Case[] = [
  // Categorical equality + negation
  {
    name: "categorical eq matches",
    query: "topic:t1",
    trace: makeTrace({ topicId: "t1" }),
    expected: true,
  },
  {
    name: "categorical eq misses",
    query: "topic:t1",
    trace: makeTrace({ topicId: "t2" }),
    expected: false,
  },
  {
    name: "categorical negation matches non-equal",
    query: "NOT topic:t1",
    trace: makeTrace({ topicId: "t2" }),
    expected: true,
  },
  {
    name: "categorical negation excludes equal",
    query: "NOT topic:t1",
    trace: makeTrace({ topicId: "t1" }),
    expected: false,
  },
  {
    name: "attribute-backed categorical matches",
    query: "user:u-9",
    trace: makeTrace({ attributes: { "langwatch.user_id": "u-9" } }),
    expected: true,
  },
  // Origin default — unstamped traces read as "application"
  {
    name: "origin defaults unstamped trace to application",
    query: "origin:application",
    trace: makeTrace({ attributes: {} }),
    expected: true,
  },
  {
    name: "origin honours an explicit stamp",
    query: "origin:web",
    trace: makeTrace({ attributes: { "langwatch.origin": "web" } }),
    expected: true,
  },
  {
    name: "origin:application misses an explicitly-stamped trace",
    query: "origin:application",
    trace: makeTrace({ attributes: { "langwatch.origin": "web" } }),
    expected: false,
  },
  // Numeric range inclusivity
  {
    name: "range includes the lower bound",
    query: "cost:[0.01 TO 1]",
    trace: makeTrace({ totalCost: 0.01 }),
    expected: true,
  },
  {
    name: "range includes the upper bound",
    query: "cost:[0.01 TO 1]",
    trace: makeTrace({ totalCost: 1 }),
    expected: true,
  },
  {
    name: "range excludes above the upper bound",
    query: "cost:[0.01 TO 1]",
    trace: makeTrace({ totalCost: 1.5 }),
    expected: false,
  },
  {
    name: "range excludes a null-valued column under both polarities",
    query: "NOT cost:[0.01 TO 1]",
    trace: makeTrace({ totalCost: null }),
    expected: false,
  },
  {
    name: "numeric > operator",
    query: "spans:>5",
    trace: makeTrace({ spanCount: 6 }),
    expected: true,
  },
  {
    name: "numeric >= operator inclusive",
    query: "spans:>=6",
    trace: makeTrace({ spanCount: 6 }),
    expected: true,
  },
  // Composed token sum
  {
    name: "composed token sum matches",
    query: "tokens:[10 TO 30]",
    trace: makeTrace({
      totalPromptTokenCount: 10,
      totalCompletionTokenCount: 15,
    }),
    expected: true,
  },
  {
    name: "composed token sum with a null operand excludes",
    query: "tokens:[10 TO 30]",
    trace: makeTrace({
      totalPromptTokenCount: 10,
      totalCompletionTokenCount: null,
    }),
    expected: false,
  },
  // List membership + wildcard
  {
    name: "model membership matches",
    query: "model:gpt-4o",
    trace: makeTrace({ models: ["gpt-4o", "gpt-3.5"] }),
    expected: true,
  },
  {
    name: "model membership misses",
    query: "model:claude-3",
    trace: makeTrace({ models: ["gpt-4o"] }),
    expected: false,
  },
  {
    name: "model wildcard matches by prefix",
    query: "model:gpt*",
    trace: makeTrace({ models: ["gpt-4o"] }),
    expected: true,
  },
  {
    name: "model wildcard misses a non-match",
    query: "model:gpt*",
    trace: makeTrace({ models: ["claude-3"] }),
    expected: false,
  },
  {
    name: "traceId wildcard matches by prefix",
    query: "trace:abc*",
    trace: makeTrace({ traceId: "abcdef" }),
    expected: true,
  },
  // label / promptIds JSON quote-trimming
  {
    name: "label membership trims JSON quotes",
    query: "label:prod",
    trace: makeTrace({
      attributes: { "langwatch.labels": '["prod","staging"]' },
    }),
    expected: true,
  },
  {
    name: "label membership misses",
    query: "label:dev",
    trace: makeTrace({
      attributes: { "langwatch.labels": '["prod","staging"]' },
    }),
    expected: false,
  },
  {
    name: "prompt membership parses the hoisted id array",
    query: "prompt:p1",
    trace: makeTrace({
      attributes: { "langwatch.prompt_ids": '["p1","p2"]' },
    }),
    expected: true,
  },
  // evaluatorVerdict — all four multiIf branches
  {
    name: "evaluatorVerdict pass",
    query: "evaluatorVerdict:pass",
    trace: makeTrace({}, { evaluations: [makeEval({ passed: true })] }),
    expected: true,
  },
  {
    name: "evaluatorVerdict fail",
    query: "evaluatorVerdict:fail",
    trace: makeTrace({}, { evaluations: [makeEval({ passed: false })] }),
    expected: true,
  },
  {
    name: "evaluatorVerdict error wins over passed",
    query: "evaluatorVerdict:error",
    trace: makeTrace(
      {},
      { evaluations: [makeEval({ status: "error", passed: true })] },
    ),
    expected: true,
  },
  {
    name: "evaluatorVerdict:pass misses an errored run",
    query: "evaluatorVerdict:pass",
    trace: makeTrace(
      {},
      { evaluations: [makeEval({ status: "error", passed: true })] },
    ),
    expected: false,
  },
  {
    name: "evaluatorVerdict unknown for null passed",
    query: "evaluatorVerdict:unknown",
    trace: makeTrace(
      {},
      { evaluations: [makeEval({ status: "processed", passed: null })] },
    ),
    expected: true,
  },
  {
    name: "evaluatorScore range over the loaded runs",
    query: "evaluatorScore:[0.5 TO 1]",
    trace: makeTrace({}, { evaluations: [makeEval({ score: 0.7 })] }),
    expected: true,
  },
  {
    name: "evaluatorStatus matches the run status",
    query: "evaluatorStatus:processed",
    trace: makeTrace({}, { evaluations: [makeEval({ status: "processed" })] }),
    expected: true,
  },
  {
    name: "evaluatorLabel matches the emitted label",
    query: "evaluatorLabel:toxic",
    trace: makeTrace({}, { evaluations: [makeEval({ label: "toxic" })] }),
    expected: true,
  },
  {
    name: "evaluatorPassed alias mirrors evaluatorVerdict",
    query: "evaluatorPassed:pass",
    trace: makeTrace({}, { evaluations: [makeEval({ passed: true })] }),
    expected: true,
  },
  // Attribute prefixes
  {
    name: "trace.attribute.<k> matches",
    query: "trace.attribute.env:prod",
    trace: makeTrace({ attributes: { env: "prod" } }),
    expected: true,
  },
  {
    name: "legacy attribute.<k> alias matches",
    query: "attribute.env:prod",
    trace: makeTrace({ attributes: { env: "prod" } }),
    expected: true,
  },
  {
    name: "event.attribute.<k> matches an event attribute",
    query: "event.attribute.exception.type:ValueError",
    trace: makeTrace(
      {},
      {
        events: [makeEvent({ attributes: { "exception.type": "ValueError" } })],
      },
    ),
    expected: true,
  },
  // Free text
  {
    name: "free text matches computed input (case-insensitive)",
    query: "HELLO",
    trace: makeTrace({ computedInput: "say hello world" }),
    expected: true,
  },
  {
    name: "free text matches computed output",
    query: "answer",
    trace: makeTrace({ computedOutput: "the answer is 42" }),
    expected: true,
  },
  {
    name: "free text misses",
    query: "missing",
    trace: makeTrace({ computedInput: "nothing here" }),
    expected: false,
  },
  {
    // NULL OR true is true in ClickHouse — a NULL column never blocks a match
    // on the other one.
    name: "free text matches when the other IO column is null",
    query: "hello",
    trace: makeTrace({ computedInput: null, computedOutput: "hello there" }),
    expected: true,
  },
  {
    name: "negated free text matches when both columns miss",
    query: "NOT refund",
    trace: makeTrace({
      computedInput: "hello",
      computedOutput: "world",
    }),
    expected: true,
  },
  {
    // NOT (NULL OR NULL) is NULL in ClickHouse, and a NULL predicate excludes
    // the row — so the dispatcher must not fire on traces with no computed IO.
    name: "negated free text excludes a trace with null computed IO",
    query: "NOT refund",
    trace: makeTrace({ computedInput: null, computedOutput: null }),
    expected: false,
  },
  {
    // NOT (NULL OR false) is also NULL — one null column poisons the negation
    // even when the other column is present and non-matching.
    name: "negated free text excludes when one IO column is null and the other misses",
    query: "NOT refund",
    trace: makeTrace({ computedInput: "hello", computedOutput: null }),
    expected: false,
  },
  {
    // NOT (NULL OR true) is false — a match on the non-null column still
    // excludes under negation, null or not.
    name: "negated free text excludes a match despite a null column",
    query: "NOT refund",
    trace: makeTrace({ computedInput: null, computedOutput: "refund please" }),
    expected: false,
  },
  // Boolean composition
  {
    name: "AND requires both sides",
    query: "topic:t1 AND model:gpt-4o",
    trace: makeTrace({ topicId: "t1", models: ["gpt-4o"] }),
    expected: true,
  },
  {
    name: "AND fails when one side misses",
    query: "topic:t1 AND model:gpt-4o",
    trace: makeTrace({ topicId: "t1", models: ["claude-3"] }),
    expected: false,
  },
  {
    name: "OR passes when either side matches",
    query: "topic:t9 OR model:gpt-4o",
    trace: makeTrace({ topicId: "t1", models: ["gpt-4o"] }),
    expected: true,
  },
  {
    name: "parenthesised grouping",
    query: "(topic:t1 OR topic:t2) AND model:gpt-4o",
    trace: makeTrace({ topicId: "t2", models: ["gpt-4o"] }),
    expected: true,
  },
  // has / none existence
  {
    name: "has:error matches an errored trace",
    query: "has:error",
    trace: makeTrace({ containsErrorStatus: true }),
    expected: true,
  },
  {
    name: "none:error matches a clean trace",
    query: "none:error",
    trace: makeTrace({ containsErrorStatus: false }),
    expected: true,
  },
  {
    name: "has:eval matches a trace with evaluations",
    query: "has:eval",
    trace: makeTrace({}, { evaluations: [makeEval()] }),
    expected: true,
  },
  {
    name: "has:eval on an empty (loaded) evaluations list misses",
    query: "has:eval",
    trace: makeTrace({}, { evaluations: [] }),
    expected: false,
  },
  {
    name: "event name matches a loaded event",
    query: "event:user_feedback",
    trace: makeTrace({}, { events: [makeEvent({ name: "user_feedback" })] }),
    expected: true,
  },
  // Fail-closed
  {
    name: "empty query matches every trace",
    query: "",
    trace: makeTrace({}),
    expected: true,
  },
  {
    name: "UNSUPPORTED field (size) fails closed",
    query: "size:100",
    trace: makeTrace({ sizeBytes: 100 }),
    expected: false,
  },
  {
    name: "UNSUPPORTED field (spanId) fails closed",
    query: "spanId:abc",
    trace: makeTrace({}),
    expected: false,
  },
  {
    name: "UNSUPPORTED span.attribute prefix fails closed",
    query: "span.attribute.gen_ai.request.model:gpt-4o",
    trace: makeTrace({}),
    expected: false,
  },
  {
    name: "has:eval without loaded evaluations fails closed",
    query: "has:eval",
    trace: makeTrace({}),
    expected: false,
  },
  {
    name: "event without loaded events fails closed",
    query: "event:user_feedback",
    trace: makeTrace({}),
    expected: false,
  },
  {
    name: "UNSUPPORTED poisons an OR that would otherwise pass",
    query: "topic:t1 OR size:100",
    trace: makeTrace({ topicId: "t1" }),
    expected: false,
  },
  {
    name: "unknown field fails closed",
    query: "totallyBogusField:x",
    trace: makeTrace({}),
    expected: false,
  },
  {
    name: "over-complex query (exceeds the node cap) fails closed",
    // 11 tags → 21 AST nodes, over MAX_NODE_COUNT (20); each would match, so a
    // `false` result proves the cap forced fail-closed rather than a miss.
    query: Array.from({ length: 11 }, () => "origin:app").join(" AND "),
    trace: makeTrace({ attributes: { "langwatch.origin": "app" } }),
    expected: false,
  },
];

describe("evaluateQueryInMemory", () => {
  it.each(cases.map((c) => [c.name, c] as const))(
    "%s",
    (_name, testCase) => {
      expect(evaluateQueryInMemory(testCase.query, testCase.trace)).toBe(
        testCase.expected,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Both-sides parity: the table above only pins the in-memory half against
// hand-written booleans, which is how `origin`'s SQL/read divergence shipped
// (the `read` defaulted a missing origin to "application", the `expression`
// was the bare map access, which ClickHouse resolves to '' — so the dispatcher
// matched every unstamped trace and the identical trace-list query matched
// none). These tests run the ClickHouse compiler too, and tie the two halves of
// each FieldDef together so that class of drift can't come back.
//
// Executing the compiled SQL against real rows needs a ClickHouse container —
// that lives in `filter-parity.integration.test.ts`.
// ---------------------------------------------------------------------------

type ExpressionFacet = ExpressionCategoricalDef | RangeFacetDef;

const hasExpression = (d: unknown): d is ExpressionFacet =>
  typeof d === "object" && d !== null && "expression" in d;

/** The facets `build-handlers` auto-derives BOTH sides from (SQL + read). */
const autoDerived = FACET_REGISTRY.filter(
  (d): d is ExpressionFacet => hasExpression(d) && d.read != null,
);

/** A trace with nothing set — every read falls back to whatever it defaults. */
const emptyTrace = makeTrace({});

describe("FieldDef SQL/read parity", () => {
  it("covers every auto-derived facet", () => {
    expect(autoDerived.length).toBeGreaterThan(10);
  });

  describe("when a facet's in-memory read applies a default", () => {
    it.each(autoDerived.map((d) => [d.key, d] as const))(
      "[%s] spells that default out in the ClickHouse expression too",
      (_key, def) => {
        const value = def.read!(emptyTrace);
        // No default (bare column: CH yields '' or NULL, and the read agrees),
        // an array-valued read, or a field that can't be read at dispatch.
        if (
          value === UNSUPPORTED ||
          value === null ||
          value === "" ||
          Array.isArray(value) ||
          typeof value === "number"
        ) {
          return;
        }
        // A read that invents a value for an unset trace is only honest if the
        // SQL invents the same one — otherwise the two halves disagree on
        // exactly the rows nobody stamped.
        expect(def.expression).toContain(`'${value}'`);
      },
    );
  });

  describe("when a field is compiled to ClickHouse", () => {
    it.each(autoDerived.map((d) => [d.key, d] as const))(
      "[%s] compiles against its registry expression",
      (key, def) => {
        const literal = def.kind === "range" ? "1" : "x";
        const compiled = translateFilterToClickHouse(
          `${key}:${literal}`,
          "tenant-1",
          { from: 0, to: 1 },
        );
        expect(compiled?.sql).toContain(def.expression);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Prototype-pollution regression: field names come from a user-authored filter
// string, so `constructor` / `toString` / `__proto__` used to resolve off
// `Object.prototype`. The inherited value is truthy, so it slipped past the
// `!def` / `!handler` guards on BOTH paths: the save-time gate accepted the
// query, and the dispatcher's "fail-closed" evaluator threw
// `def.evaluateInMemory is not a function` out of `handleSettle` — one saved
// automation poisoning trigger dispatch for the whole project.
//
// These execute the paths; asserting on generated strings would not have caught
// the throw.
// ---------------------------------------------------------------------------

const PROTOTYPE_FIELDS = [
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
  "propertyIsEnumerable",
];

describe("given a filter field that collides with an Object.prototype member", () => {
  describe("when the dispatcher evaluates it in memory", () => {
    it.each(PROTOTYPE_FIELDS)(
      "[%s] fails closed instead of throwing",
      (field) => {
        expect(() =>
          evaluateQueryInMemory(`${field}:x`, makeTrace({})),
        ).not.toThrow();
        expect(evaluateQueryInMemory(`${field}:x`, makeTrace({}))).toBe(false);
      },
    );

    it("fails closed when the poisoned tag is OR-ed with a matching one", () => {
      expect(
        evaluateQueryInMemory("topic:t1 OR constructor:x", makeTrace({ topicId: "t1" })),
      ).toBe(false);
    });
  });

  describe("when the save-time gate compiles it", () => {
    it.each(PROTOTYPE_FIELDS)("[%s] is rejected as an unknown field", (field) => {
      expect(() =>
        translateFilterToClickHouse(`${field}:x`, "tenant-1", {
          from: 0,
          to: 1,
        }),
      ).toThrow(FilterFieldUnknownError);
    });
  });

  describe("when the value of has/none names a prototype member", () => {
    it("reads an absent attribute as absent, matching Attributes['constructor'] = ''", () => {
      // `Attributes['constructor'] != ''` is false in ClickHouse for every
      // trace that never carried the key; the in-memory read must agree rather
      // than hand back the inherited `Object.prototype.constructor`.
      expect(
        evaluateQueryInMemory("has:attribute.constructor", makeTrace({})),
      ).toBe(false);
      expect(
        evaluateQueryInMemory("none:attribute.constructor", makeTrace({})),
      ).toBe(true);
    });

    it("still matches an attribute genuinely named constructor", () => {
      expect(
        evaluateQueryInMemory(
          "has:attribute.constructor",
          makeTrace({ attributes: { constructor: "yes" } }),
        ),
      ).toBe(true);
      expect(
        evaluateQueryInMemory(
          "trace.attribute.constructor:yes",
          makeTrace({ attributes: { constructor: "yes" } }),
        ),
      ).toBe(true);
    });
  });

  describe("when the needs collector walks it", () => {
    it.each(PROTOTYPE_FIELDS)("[%s] resolves no auxiliary needs", (field) => {
      expect(queryNeeds(`${field}:x`).size).toBe(0);
    });
  });
});

describe("queryNeeds", () => {
  describe("when a query references cross-table fields", () => {
    it("collects evaluations for evaluator fields", () => {
      expect([...queryNeeds("evaluatorVerdict:pass")]).toEqual(["evaluations"]);
    });

    it("collects events for event fields and prefixes", () => {
      expect(queryNeeds("event:user_feedback").has("events")).toBe(true);
      expect(
        queryNeeds("event.attribute.exception.type:x").has("events"),
      ).toBe(true);
    });

    it("collects spans for span fields and prefixes", () => {
      expect(queryNeeds("spanType:llm").has("spans")).toBe(true);
      expect(queryNeeds("span.attribute.k:v").has("spans")).toBe(true);
    });

    it("resolves has/none value-polymorphic needs", () => {
      expect([...queryNeeds("has:eval")]).toEqual(["evaluations"]);
      expect([...queryNeeds("none:feedback")]).toEqual(["events"]);
      expect(queryNeeds("has:error").size).toBe(0);
    });

    it("unions needs across a compound query", () => {
      const needs = queryNeeds("evaluatorVerdict:pass AND event:x");
      expect(needs).toEqual(new Set(["evaluations", "events"]));
    });
  });

  describe("when a query is summary-only or invalid", () => {
    it("returns an empty set for trace-summary fields", () => {
      expect(queryNeeds("topic:t1 AND model:gpt-4o").size).toBe(0);
    });

    it("returns an empty set for an unparseable query", () => {
      expect(queryNeeds("((").size).toBe(0);
    });
  });
});
