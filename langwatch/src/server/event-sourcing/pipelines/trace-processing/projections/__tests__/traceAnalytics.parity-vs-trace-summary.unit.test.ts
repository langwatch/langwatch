import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  applySpanToAnalytics,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
} from "../traceAnalytics.foldProjection";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";
import type { NormalizedSpan } from "../../schemas/spans";

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
 * Field-by-field parity assertions over the shared fields both folds carry.
 * The slim row's projected typed columns come from this list; if they match
 * trace_summaries here, they match in the projected slim row too.
 */
function assertSharedFieldsParity({
  summary,
  slim,
}: {
  summary: TraceSummaryData;
  slim: TraceAnalyticsData;
}): void {
  // Identity / counters
  expect(slim.traceId).toBe(summary.traceId);

  // Trace-name + topic
  expect(slim.traceName).toBe(summary.traceName);
  expect(slim.topicId).toBe(summary.topicId);
  expect(slim.subTopicId).toBe(summary.subTopicId);

  // Models — order-sensitive: mergeModelsMostRecentFirst is shared.
  expect(slim.models).toEqual(summary.models);

  // Timing
  expect(slim.occurredAt).toBe(summary.occurredAt);
  expect(slim.totalDurationMs).toBe(summary.totalDurationMs);
  expect(slim.timeToFirstTokenMs).toBe(summary.timeToFirstTokenMs);
  expect(slim.tokensPerSecond).toBe(summary.tokensPerSecond);

  // Cost / tokens
  expect(slim.totalCost).toBe(summary.totalCost);
  expect(slim.nonBilledCost).toBe(summary.nonBilledCost);
  expect(slim.totalPromptTokenCount).toBe(summary.totalPromptTokenCount);
  expect(slim.totalCompletionTokenCount).toBe(summary.totalCompletionTokenCount);

  // Status
  expect(slim.containsErrorStatus).toBe(summary.containsErrorStatus);

  // HasAnnotation source
  expect(slim.annotationIds.length > 0).toBe(
    summary.annotationIds.length > 0,
  );

  // Hoisted dim values (read off attribute map) — these become the typed
  // columns on the slim row, so parity on the attribute strings means
  // parity on the projected typed values.
  expect(slim.attributes["langwatch.user_id"]).toBe(
    summary.attributes["langwatch.user_id"],
  );
  expect(slim.attributes["gen_ai.conversation.id"]).toBe(
    summary.attributes["gen_ai.conversation.id"],
  );
  expect(slim.attributes["langwatch.customer_id"]).toBe(
    summary.attributes["langwatch.customer_id"],
  );
  expect(slim.attributes["langwatch.origin"]).toBe(
    summary.attributes["langwatch.origin"],
  );
  expect(slim.attributes["langwatch.labels"]).toBe(
    summary.attributes["langwatch.labels"],
  );

  // Reserved-key token sums slim's cache*/reasoningTokens columns read from.
  expect(slim.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
    summary.attributes["langwatch.reserved.cache_read_tokens"],
  );
  expect(slim.attributes["langwatch.reserved.cache_creation_tokens"]).toBe(
    summary.attributes["langwatch.reserved.cache_creation_tokens"],
  );
  expect(slim.attributes["langwatch.reserved.reasoning_tokens"]).toBe(
    summary.attributes["langwatch.reserved.reasoning_tokens"],
  );
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
      assertSharedFieldsParity(out);
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
      assertSharedFieldsParity({ summary, slim });

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

      assertSharedFieldsParity({ summary, slim });
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

      assertSharedFieldsParity({ summary, slim });
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
      assertSharedFieldsParity({ summary, slim });
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
      assertSharedFieldsParity({ summary, slim });
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

      // Topic-assigned handler on both folds simply sets these fields —
      // simulate it by editing state directly. The handlers themselves are
      // structurally identical; this test guards the field shape.
      summary = { ...summary, topicId: "topic-billing", subTopicId: "sub-x" };
      slim = { ...slim, topicId: "topic-billing", subTopicId: "sub-x" };

      assertSharedFieldsParity({ summary, slim });
    });
  });
});
