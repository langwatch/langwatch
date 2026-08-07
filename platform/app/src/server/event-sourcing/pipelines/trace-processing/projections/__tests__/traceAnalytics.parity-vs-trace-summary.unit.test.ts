import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TopicAssignedEvent } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";
import {
  applySpanToAnalytics,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../traceAnalytics.foldProjection";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

/**
 * Drift guard: the slim fold's handlers MUST produce the same values as the
 * trace-summary fold on every field slim DOES carry. The slim fold drops
 * heavy fields (computedInput/Output, scenario roles, prompt tracking, the
 * span-cost map, …) but everything else — cost, tokens, models, timing,
 * hoisted dims, error status, annotations — has to match to the cent.
 *
 * Service reuse is the architectural drift mitigation; this test is the
 * runtime confirmation. If a service's behaviour changes both folds pick it
 * up; if slim's orchestration ever diverges (a forgotten merge, an
 * accidental short-circuit) this test fails LOUDLY on the field that drifted.
 */

const slimProjection = new TraceAnalyticsFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

const summaryProjection = new TraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
} as never);

/** Minimal TopicAssignedEvent — only `data` is read by either handler. */
function topicAssignedEvent(
  topicId: string | null,
  subtopicId: string | null,
): TopicAssignedEvent {
  return {
    id: "evt-topic-1",
    type: "trace.topic_assigned",
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    data: { topicId, subtopicId },
    metadata: {},
  } as unknown as TopicAssignedEvent;
}

function createInitSlimState(): TraceAnalyticsData {
  return slimProjection.init();
}

function applyToBoth(
  span: NormalizedSpan,
  summaryState: TraceSummaryData,
  slimState: TraceAnalyticsData,
): { summary: TraceSummaryData; slim: TraceAnalyticsData } {
  return {
    summary: applySpanToSummary({ state: summaryState, span }),
    slim: applySpanToAnalytics({ state: slimState, span }),
  };
}

/**
 * Projection of the shared fields both folds carry, so each test asserts
 * parity with a single `toEqual` over both projections (full diff on
 * failure). The slim row's projected typed columns come from this list; if
 * they match trace_summaries here, they match in the projected slim row too.
 */
function sharedFields(state: TraceSummaryData | TraceAnalyticsData) {
  return {
    // Identity
    traceId: state.traceId,

    // Trace-name + topic
    traceName: state.traceName,
    topicId: state.topicId,
    subTopicId: state.subTopicId,

    // Models — order-sensitive: mergeModelsMostRecentFirst is shared.
    models: state.models,

    // Timing
    occurredAt: state.occurredAt,
    totalDurationMs: state.totalDurationMs,
    timeToFirstTokenMs: state.timeToFirstTokenMs,
    tokensPerSecond: state.tokensPerSecond,

    // Cost / tokens
    totalCost: state.totalCost,
    nonBilledCost: state.nonBilledCost,
    totalPromptTokenCount: state.totalPromptTokenCount,
    totalCompletionTokenCount: state.totalCompletionTokenCount,

    // Status
    containsErrorStatus: state.containsErrorStatus,

    // HasAnnotation source
    hasAnnotation: state.annotationIds.length > 0,

    // Hoisted dim values (read off attribute map) — these become the typed
    // columns on the slim row, so parity on the attribute strings means
    // parity on the projected typed values. The reserved-key token sums are
    // what slim's cache*/reasoningTokens columns read from.
    attributes: {
      "langwatch.user_id": state.attributes["langwatch.user_id"],
      "gen_ai.conversation.id": state.attributes["gen_ai.conversation.id"],
      "langwatch.customer_id": state.attributes["langwatch.customer_id"],
      "langwatch.origin": state.attributes["langwatch.origin"],
      "langwatch.labels": state.attributes["langwatch.labels"],
      "langwatch.reserved.cache_read_tokens":
        state.attributes["langwatch.reserved.cache_read_tokens"],
      "langwatch.reserved.cache_creation_tokens":
        state.attributes["langwatch.reserved.cache_creation_tokens"],
      "langwatch.reserved.reasoning_tokens":
        state.attributes["langwatch.reserved.reasoning_tokens"],
    },
  };
}

describe("traceAnalytics fold projection — parity vs trace-summary fold", () => {
  describe("given a simple single-span trace", () => {
    it("matches on every shared field", () => {
      const summary = createInitState();
      const slim = createInitSlimState();
      const span = createTestSpan({
        spanId: "root-1",
        parentSpanId: null,
        startTimeUnixMs: 1000,
        endTimeUnixMs: 2500,
        durationMs: 1500,
        name: "chat completion",
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 12,
          "gen_ai.usage.output_tokens": 7,
          "langwatch.span.cost": 0.02,
          "langwatch.user.id": "user-1",
          "gen_ai.conversation.id": "thread-1",
          "langwatch.origin": "playground",
        },
      });
      const out = applyToBoth(span, summary, slim);
      expect(sharedFields(out.slim)).toEqual(sharedFields(out.summary));
    });
  });

  describe("given a multi-span trace (non-root then root)", () => {
    it("matches on every shared field after both spans", () => {
      let summary = createInitState();
      let slim = createInitSlimState();

      const spanA = createTestSpan({
        spanId: "child-a",
        parentSpanId: "root-x",
        startTimeUnixMs: 2000,
        endTimeUnixMs: 3000,
        durationMs: 1000,
        name: "child span",
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 5,
          "gen_ai.usage.output_tokens": 3,
          "langwatch.span.cost": 0.005,
          "gen_ai.usage.cache_read_input_tokens": 100,
          "gen_ai.usage.cache_creation_input_tokens": 50,
          "gen_ai.usage.reasoning_tokens": 25,
        },
      });
      summary = applySpanToSummary({ state: summary, span: spanA });
      slim = applySpanToAnalytics({ state: slim, span: spanA });
      expect(sharedFields(slim)).toEqual(sharedFields(summary));

      const spanRoot = createTestSpan({
        spanId: "root-x",
        parentSpanId: null,
        startTimeUnixMs: 1000,
        endTimeUnixMs: 4000,
        durationMs: 3000,
        name: "outer chain",
        spanAttributes: {
          "langwatch.span.type": "agent",
          "gen_ai.response.model": "claude-opus-4",
          "gen_ai.usage.input_tokens": 30,
          "gen_ai.usage.output_tokens": 20,
          "langwatch.span.cost": 0.04,
          "langwatch.origin": "application",
          "langwatch.user.id": "user-7",
          "langwatch.labels": JSON.stringify(["prod", "beta"]),
        },
      });
      summary = applySpanToSummary({ state: summary, span: spanRoot });
      slim = applySpanToAnalytics({ state: slim, span: spanRoot });

      expect(sharedFields(slim)).toEqual(sharedFields(summary));
    });
  });

  describe("given a trace then an annotation added", () => {
    it("matches on the annotation-derived HasAnnotation signal", () => {
      let summary = createInitState();
      let slim = createInitSlimState();

      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.response.model": "gpt-5-mini",
        },
      });
      summary = applySpanToSummary({ state: summary, span });
      slim = applySpanToAnalytics({ state: slim, span });

      // Simulate the annotation handler being invoked on both.
      summary = { ...summary, annotationIds: [...summary.annotationIds, "a1"] };
      slim = { ...slim, annotationIds: [...slim.annotationIds, "a1"] };

      expect(sharedFields(slim)).toEqual(sharedFields(summary));
    });
  });

  describe("given an error-status span", () => {
    it("matches on containsErrorStatus", () => {
      // statusCode 2 = ERROR (NormalizedStatusCode.ERROR)
      const span = createTestSpan({
        parentSpanId: null,
        statusCode: 2,
        statusMessage: "internal",
        spanAttributes: {
          "langwatch.span.type": "llm",
        },
      });
      const summary = applySpanToSummary({
        state: createInitState(),
        span,
      });
      const slim = applySpanToAnalytics({
        state: createInitSlimState(),
        span,
      });
      expect(sharedFields(slim)).toEqual(sharedFields(summary));
      expect(slim.containsErrorStatus).toBe(true);
    });
  });

  describe("given a trace whose spans populate heavy-only fields", () => {
    it("still matches on shared fields (slim ignores the heavy ones)", () => {
      // The span carries gen_ai.prompt / gen_ai.completion (IO payload) +
      // langwatch.prompt.id (prompt tracking). The trace-summary fold lifts
      // those into computedInput/computedOutput/prompt fields; slim drops
      // them. Shared fields (cost/tokens/timing) must still agree.
      const span = createTestSpan({
        parentSpanId: null,
        startTimeUnixMs: 500,
        endTimeUnixMs: 1500,
        durationMs: 1000,
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 8,
          "gen_ai.usage.output_tokens": 4,
          "langwatch.span.cost": 0.012,
          "gen_ai.prompt": "say hello",
          "gen_ai.completion": "hello there",
          "langwatch.prompt.id": "prompt-abc:1",
          "gen_ai.conversation.id": "convo-9",
        },
      });
      const summary = applySpanToSummary({
        state: createInitState(),
        span,
      });
      const slim = applySpanToAnalytics({
        state: createInitSlimState(),
        span,
      });
      expect(sharedFields(slim)).toEqual(sharedFields(summary));
    });
  });

  describe("given a multi-event sequence (span then topic-assigned-equivalent state edit)", () => {
    it("matches on topic fields after both folds apply the topic", () => {
      let summary = createInitState();
      let slim = createInitSlimState();

      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.response.model": "gpt-5-mini",
        },
      });
      summary = applySpanToSummary({ state: summary, span });
      slim = applySpanToAnalytics({ state: slim, span });

      // Drive the REAL handlers on both folds. Hand-mutating state here would
      // make this drift guard assert nothing about the handlers it claims to
      // guard — the whole point is that a divergent `handleTraceTopicAssigned`
      // fails loudly.
      const event = topicAssignedEvent("topic-billing", "sub-x");
      summary = summaryProjection.handleTraceTopicAssigned(event, summary);
      slim = slimProjection.handleTraceTopicAssigned(event, slim);

      expect(slim.topicId).toBe("topic-billing");
      expect(slim.subTopicId).toBe("sub-x");
      expect(sharedFields(slim)).toEqual(sharedFields(summary));
    });

    it("preserves prior topic ids when the event carries nulls, on both folds", () => {
      let summary = createInitState();
      let slim = createInitSlimState();
      const span = createTestSpan({ parentSpanId: null });
      summary = applySpanToSummary({ state: summary, span });
      slim = applySpanToAnalytics({ state: slim, span });

      const assign = topicAssignedEvent("topic-billing", "sub-x");
      summary = summaryProjection.handleTraceTopicAssigned(assign, summary);
      slim = slimProjection.handleTraceTopicAssigned(assign, slim);

      // `topicId: event.data.topicId ?? state.topicId` — a null must not clear.
      const nulls = topicAssignedEvent(null, null);
      summary = summaryProjection.handleTraceTopicAssigned(nulls, summary);
      slim = slimProjection.handleTraceTopicAssigned(nulls, slim);

      expect(slim.topicId).toBe("topic-billing");
      expect(slim.subTopicId).toBe("sub-x");
      expect(sharedFields(slim)).toEqual(sharedFields(summary));
    });
  });
});
