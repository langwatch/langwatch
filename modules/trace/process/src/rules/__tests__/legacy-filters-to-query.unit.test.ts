import { type FilterField, filterFieldsEnum } from "@langwatch/analytics-contract";
import type { DerivedTraceEvent, InMemoryTrace, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { LegacyFilterMatchingService } from "../../services/legacy-filter-matching.service.ts";
import { PreconditionTraceDataService } from "../../services/precondition-trace-data.service.ts";
import {
  type LegacyFilterRefusalReason,
  translateLegacyFiltersToQuery,
} from "../legacy-filters-to-query.rules.ts";
import { traceMatchesQuery } from "../trace-query-evaluation.rules.ts";

const LEGACY = LegacyFilterMatchingService.create({
  preconditionTraceData: PreconditionTraceDataService.create(),
});

const BASE_SUMMARY: TraceSummaryData = {
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

function trace({
  summary = {},
  events = null,
}: {
  summary?: Partial<TraceSummaryData>;
  events?: DerivedTraceEvent[] | null;
} = {}): InMemoryTrace {
  return { summary: { ...BASE_SUMMARY, ...summary }, events };
}

function withAttributes(attributes: Record<string, string>): InMemoryTrace {
  return trace({ summary: { attributes } });
}

function eventNamed(name: string): DerivedTraceEvent {
  return { spanId: "s1", timestamp: 0, name, attributes: {} };
}

function translated({ filters }: { filters: Record<string, unknown> }): string {
  const result = translateLegacyFiltersToQuery({ filters });
  if (result.status !== "translated") {
    throw new Error(`${result.filter}: ${result.reason}`);
  }

  return result.query;
}

/** The translation must match exactly the traces the legacy matcher matches. */
function expectAgreement({
  filters,
  traces,
}: {
  filters: Record<string, unknown>;
  traces: InMemoryTrace[];
}): string {
  const query = translated({ filters });
  const legacy = traces.map((t) =>
    LEGACY.matchesTraceFilters({
      filters,
      foldState: t.summary,
      events: t.events ?? null,
    }),
  );
  const migrated = traces.map((t) => traceMatchesQuery(query, t));

  expect(migrated).toEqual(legacy);
  expect(legacy).toContain(true);
  expect(legacy).toContain(false);

  return query;
}

describe("translateLegacyFiltersToQuery", () => {
  describe("when the filters are vacuous", () => {
    it("translates to an empty query for {}, empty arrays and empty keyed values", () => {
      expect(translated({ filters: {} })).toBe("");
      expect(translated({ filters: { "traces.origin": [] } })).toBe("");
      expect(translated({ filters: { "metadata.value": { env: [] } } })).toBe("");
      expect(translated({ filters: { "evaluations.passed": [] } })).toBe("");
    });
  });

  describe("when a filter reads a trace field", () => {
    it("translates traces.origin as an OR over its values", () => {
      const query = expectAgreement({
        filters: { "traces.origin": ["application", "playground"] },
        traces: [
          withAttributes({ "langwatch.origin": "application" }),
          withAttributes({ "langwatch.origin": "playground" }),
          withAttributes({ "langwatch.origin": "evaluation" }),
        ],
      });
      expect(query).toBe("(origin:application OR origin:playground)");
    });

    it("translates traces.error true and false to the existence probes", () => {
      const traces = [
        trace({ summary: { containsErrorStatus: true } }),
        trace({ summary: { containsErrorStatus: false } }),
      ];
      expect(expectAgreement({ filters: { "traces.error": ["true"] }, traces })).toBe("has:error");
      expect(expectAgreement({ filters: { "traces.error": ["false"] }, traces })).toBe(
        "none:error",
      );
      expect(translated({ filters: { "traces.error": ["true", "false"] } })).toBe("");
    });

    it("translates annotations.hasAnnotation true and false", () => {
      const traces = [
        trace({ summary: { annotationIds: ["a1"] } }),
        trace({ summary: { annotationIds: [] } }),
      ];
      expect(expectAgreement({ filters: { "annotations.hasAnnotation": ["true"] }, traces })).toBe(
        "has:annotation",
      );
      expect(expectAgreement({ filters: { "annotations.hasAnnotation": ["false"] }, traces })).toBe(
        "none:annotation",
      );
    });

    it("translates topics.topics and topics.subtopics", () => {
      const traces = [
        trace({ summary: { topicId: "t1", subTopicId: "s1" } }),
        trace({ summary: { topicId: "t2", subTopicId: "s2" } }),
      ];
      expect(expectAgreement({ filters: { "topics.topics": ["t1"] }, traces })).toBe("topic:t1");
      expect(expectAgreement({ filters: { "topics.subtopics": ["s2"] }, traces })).toBe(
        "subtopic:s2",
      );
    });

    it("translates spans.model against the fold state's models", () => {
      const traces = [
        trace({ summary: { models: ["gpt-4", "gpt-5-mini"] } }),
        trace({ summary: { models: ["claude"] } }),
      ];
      expect(expectAgreement({ filters: { "spans.model": ["gpt-5-mini"] }, traces })).toBe(
        "model:gpt-5-mini",
      );
    });

    it("translates events.event_type against the settled events", () => {
      const traces = [
        trace({ events: [eventNamed("thumbs_up")] }),
        trace({ events: [eventNamed("other")] }),
        trace({ events: null }),
      ];
      expect(expectAgreement({ filters: { "events.event_type": ["thumbs_up"] }, traces })).toBe(
        "event:thumbs_up",
      );
    });
  });

  describe("when a filter reads a metadata attribute", () => {
    const identity = [
      withAttributes({
        "langwatch.user_id": "u1",
        "gen_ai.conversation.id": "c1",
        "langwatch.customer_id": "k1",
        "langwatch.labels": JSON.stringify(["prod", "a*b"]),
        "langwatch.prompt_ids": JSON.stringify(["p1", "p2"]),
      }),
      withAttributes({
        "langwatch.user_id": "u2",
        "gen_ai.conversation.id": "c2",
        "langwatch.customer_id": "k2",
        "langwatch.labels": JSON.stringify(["staging"]),
        "langwatch.prompt_ids": JSON.stringify(["p3"]),
      }),
    ];

    it.each([
      ["metadata.user_id", ["u1"], "user:u1"],
      ["metadata.thread_id", ["c1"], "conversation:c1"],
      ["metadata.customer_id", ["k1"], "customer:k1"],
      ["metadata.labels", ["prod"], "label:prod"],
      ["metadata.prompt_ids", ["p2"], "prompt:p2"],
    ])("translates %s", (field, values, expected) => {
      expect(expectAgreement({ filters: { [field]: values }, traces: identity })).toBe(expected);
    });

    it("keeps a literal asterisk exact where the facet has no wildcard", () => {
      const query = expectAgreement({
        filters: { "metadata.labels": ["a*b"] },
        traces: identity,
      });
      expect(query).toBe('label:"a*b"');
    });

    it("translates metadata.value across the three attribute spellings", () => {
      const query = expectAgreement({
        filters: { "metadata.value": { env: ["prod", "staging"] } },
        traces: [
          withAttributes({ "metadata.env": "prod" }),
          withAttributes({ "langwatch.metadata.env": "staging" }),
          withAttributes({ env: "prod" }),
          withAttributes({ "metadata.env": "dev" }),
          withAttributes({}),
        ],
      });
      expect(query).toContain("trace.attribute.metadata.env:prod");
      expect(query).toContain("trace.attribute.langwatch.metadata.env:staging");
      expect(query).toContain("trace.attribute.env:prod");
    });

    it("translates metadata.value keys and values that need quoting", () => {
      const query = expectAgreement({
        filters: { "metadata.value": { "a:b": ['say "hi"', "1e3"] } },
        traces: [
          withAttributes({ "metadata.a:b": 'say "hi"' }),
          withAttributes({ "metadata.a:b": "1e3" }),
          withAttributes({ "metadata.a:b": "1000" }),
        ],
      });
      expect(query).toContain('"trace.attribute.metadata.a:b":"1e3"');
    });

    it("reads the middle-dot key encoding as a dot", () => {
      expectAgreement({
        filters: { "metadata.value": { a·b: ["x"] } },
        traces: [withAttributes({ "metadata.a.b": "x" }), withAttributes({ "metadata.a.b": "y" })],
      });
    });

    it("quotes values that would read as liqe literals or operators", () => {
      const traces = [
        withAttributes({ "langwatch.user_id": "true" }),
        withAttributes({ "langwatch.user_id": "AND" }),
        withAttributes({ "langwatch.user_id": "007" }),
        withAttributes({ "langwatch.user_id": "other" }),
      ];
      for (const user of ["true", "AND", "007"]) {
        expectAgreement({ filters: { "metadata.user_id": [user] }, traces });
      }
    });
  });

  describe("when several filters are set", () => {
    it("joins filters with AND and keeps each OR grouped", () => {
      const query = expectAgreement({
        filters: {
          "traces.origin": ["application"],
          "metadata.user_id": ["u1", "u2"],
          "traces.error": ["true"],
        },
        traces: [
          trace({
            summary: {
              containsErrorStatus: true,
              attributes: { "langwatch.origin": "application", "langwatch.user_id": "u2" },
            },
          }),
          trace({
            summary: {
              containsErrorStatus: false,
              attributes: { "langwatch.origin": "application", "langwatch.user_id": "u2" },
            },
          }),
          trace({
            summary: {
              containsErrorStatus: true,
              attributes: { "langwatch.origin": "playground", "langwatch.user_id": "u1" },
            },
          }),
        ],
      });
      expect(query).toBe("origin:application AND (user:u1 OR user:u2) AND has:error");
    });

    it("names the first untranslatable filter and nothing else", () => {
      expect(
        translateLegacyFiltersToQuery({
          filters: { "traces.origin": ["application"], "evaluations.passed": ["true"] },
        }),
      ).toEqual({
        status: "untranslatable",
        filter: "evaluations.passed",
        reason: "evaluation_filter",
      });
    });
  });

  describe("when a filter cannot be answered exactly", () => {
    it.each<[string, Record<string, unknown>, string, LegacyFilterRefusalReason]>([
      [
        "a wildcard in a wildcard facet",
        { "metadata.user_id": ["u*"] },
        "metadata.user_id",
        "wildcard_value",
      ],
      ["an empty value", { "topics.topics": [""] }, "topics.topics", "empty_value"],
      [
        "only unknown boolean values",
        { "traces.error": ["maybe"] },
        "traces.error",
        "unmatchable_values",
      ],
      [
        "a keyed shape on a simple field",
        { "traces.origin": { k: ["v"] } },
        "traces.origin",
        "unsupported_shape",
      ],
      [
        "a bare array on a keyed field",
        { "metadata.value": ["v"] },
        "metadata.value",
        "unsupported_shape",
      ],
      ["a non-string value", { "traces.origin": [1] }, "traces.origin", "unsupported_shape"],
      [
        "a metadata key the query gate rejects",
        { "metadata.value": { "my key": ["v"] } },
        "metadata.value",
        "rejected_by_query_gate",
      ],
      [
        "a value the query gate rejects",
        { "topics.topics": ["x".repeat(2000)] },
        "topics.topics",
        "rejected_by_query_gate",
      ],
      ["an empty metadata key", { "metadata.value": { "": ["v"] } }, "metadata.value", "empty_key"],
      ["an unknown filter key", { "nope.key": ["v"] }, "nope.key", "unknown_filter_key"],
    ])("refuses %s", (_name, filters, filter, reason) => {
      expect(translateLegacyFiltersToQuery({ filters })).toEqual({
        status: "untranslatable",
        filter,
        reason,
      });
    });

    it("ignores an unknown filter key with nothing to match", () => {
      expect(translated({ filters: { "nope.key": [] } })).toBe("");
    });
  });
});

type Expectation =
  | { sample: unknown; status: "translated" }
  | { sample: unknown; status: "untranslatable"; reason: LegacyFilterRefusalReason };

/** Every legacy filter key, so a new one fails here until it is decided. */
const EVERY_FILTER_KEY: Record<FilterField, Expectation> = {
  "traces.origin": { sample: ["application"], status: "translated" },
  "traces.error": { sample: ["true"], status: "translated" },
  "traces.name": { sample: ["x"], status: "untranslatable", reason: "never_matches_at_settlement" },
  "metadata.user_id": { sample: ["u1"], status: "translated" },
  "metadata.thread_id": { sample: ["c1"], status: "translated" },
  "metadata.customer_id": { sample: ["k1"], status: "translated" },
  "metadata.labels": { sample: ["prod"], status: "translated" },
  "metadata.prompt_ids": { sample: ["p1"], status: "translated" },
  "metadata.key": {
    sample: ["env"],
    status: "untranslatable",
    reason: "never_matches_at_settlement",
  },
  "metadata.value": { sample: { env: ["prod"] }, status: "translated" },
  "topics.topics": { sample: ["t1"], status: "translated" },
  "topics.subtopics": { sample: ["s1"], status: "translated" },
  "spans.type": {
    sample: ["llm"],
    status: "untranslatable",
    reason: "never_matches_at_settlement",
  },
  "spans.model": { sample: ["gpt-4"], status: "translated" },
  "events.event_type": { sample: ["thumbs_up"], status: "translated" },
  "events.metrics.key": {
    sample: { e: ["m"] },
    status: "untranslatable",
    reason: "no_query_equivalent",
  },
  "events.metrics.value": {
    sample: { e: { m: ["1", "2"] } },
    status: "untranslatable",
    reason: "no_query_equivalent",
  },
  "events.event_details.key": {
    sample: { e: ["k"] },
    status: "untranslatable",
    reason: "no_query_equivalent",
  },
  "annotations.hasAnnotation": { sample: ["true"], status: "translated" },
  "evaluations.evaluator_id": {
    sample: ["ev"],
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.evaluator_id.guardrails_only": {
    sample: { ev: ["true"] },
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.evaluator_id.has_passed": {
    sample: { ev: ["true"] },
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.evaluator_id.has_score": {
    sample: { ev: ["1"] },
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.evaluator_id.has_label": {
    sample: { ev: ["l"] },
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.passed": { sample: ["true"], status: "untranslatable", reason: "evaluation_filter" },
  "evaluations.score": { sample: ["1"], status: "untranslatable", reason: "evaluation_filter" },
  "evaluations.state": {
    sample: ["processed"],
    status: "untranslatable",
    reason: "evaluation_filter",
  },
  "evaluations.label": { sample: ["l"], status: "untranslatable", reason: "evaluation_filter" },
};

describe("every legacy filter key", () => {
  it("has a decided translation, and no decision names a key that no longer exists", () => {
    expect(Object.keys(EVERY_FILTER_KEY).toSorted()).toEqual(filterFieldsEnum.options.toSorted());
  });

  it.each(filterFieldsEnum.options)("%s translates or is named as untranslatable", (key) => {
    const expected = EVERY_FILTER_KEY[key];
    const result = translateLegacyFiltersToQuery({ filters: { [key]: expected.sample } });

    const anyQuery = expect.stringMatching(/\S/);
    const wanted =
      expected.status === "translated"
        ? { status: "translated", query: anyQuery }
        : { status: "untranslatable", filter: key, reason: expected.reason };
    expect(result).toEqual(wanted);
  });
});
