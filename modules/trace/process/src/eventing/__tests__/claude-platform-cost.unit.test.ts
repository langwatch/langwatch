/**
 * Claude SDK and Claude API spans report `gen_ai.usage.input_tokens` with the cache reads and
 * writes included. Every pricing fold must price each token once, at its bucket's rate.
 * Spec: specs/trace-processing/claude-platform-telemetry.feature.
 */
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceAnalyticsRollupMapProjection } from "../trace-rollup.projection.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./trace-summary-test.fixtures.ts";

const SDK_SCOPE = "com.anthropic.sdk.python";
const TRACE_ID = "c1a0de0e1e5700000000000000000001";

const runtime = createTestRuntime();
const noopFoldStore = { store: async () => {}, get: async () => ({ kind: "empty" as const }) };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

type Attributes = Record<string, string | number>;

function sdkSpan({
  spanId,
  name = "anthropic.messages.create",
  attributes,
}: {
  spanId: string;
  name?: string;
  attributes: Attributes;
}): SpanReceivedEvent {
  const event = createSpanReceivedEvent({ traceId: TRACE_ID, spanId, name, attributes });
  return { ...event, data: { ...event.data, instrumentationScope: { name: SDK_SCOPE } } };
}

function messagesCreate({
  spanId,
  model,
  input,
  output,
  cacheRead = 0,
  cacheWrite = 0,
  extra = {},
}: {
  spanId: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  extra?: Attributes;
}): SpanReceivedEvent {
  return sdkSpan({
    spanId,
    attributes: {
      "gen_ai.provider.name": "anthropic",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "anthropic.request.id": `req_${spanId}`,
      "gen_ai.usage.input_tokens": input,
      "gen_ai.usage.output_tokens": output,
      "gen_ai.usage.cache_read.input_tokens": cacheRead,
      "gen_ai.usage.cache_write.input_tokens": cacheWrite,
      ...extra,
    },
  });
}

type Totals = {
  cost: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Each pricing fold's totals over the events, the cost rounded to a millionth of a dollar. */
function pricedBy(events: SpanReceivedEvent[]): Record<string, Totals> {
  const summary = TraceSummaryFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  const analytics = TraceAnalyticsFoldProjection.create({
    store: noopFoldStore,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime,
  });
  const rollup = TraceAnalyticsRollupMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  });

  let summaryState = summary.init();
  let analyticsState = analytics.init();
  const rollupTotals: Totals = {
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const event of events) {
    summaryState = summary.handleTraceSpanReceived(event, summaryState);
    analyticsState = analytics.handleTraceSpanReceived(event, analyticsState);
    const row = rollup.mapTraceSpanReceived(event);
    if (row) {
      rollupTotals.cost += row.costSum;
      rollupTotals.promptTokens += row.promptTokensSum;
      rollupTotals.completionTokens += row.completionTokensSum;
      rollupTotals.cacheReadTokens += row.cacheReadTokensSum;
      rollupTotals.cacheWriteTokens += row.cacheWriteTokensSum;
    }
  }

  const caches = {
    cacheReadTokens: rollupTotals.cacheReadTokens,
    cacheWriteTokens: rollupTotals.cacheWriteTokens,
  };
  return {
    traceSummary: {
      cost: toMicros(summaryState.totalCost ?? 0),
      promptTokens: summaryState.totalPromptTokenCount ?? 0,
      completionTokens: summaryState.totalCompletionTokenCount ?? 0,
      ...caches,
    },
    traceAnalytics: {
      cost: toMicros(analyticsState.totalCost ?? 0),
      promptTokens: analyticsState.totalPromptTokenCount ?? 0,
      completionTokens: analyticsState.totalCompletionTokenCount ?? 0,
      ...caches,
    },
    analyticsRollup: { ...rollupTotals, cost: toMicros(rollupTotals.cost) },
  };
}

function toMicros(cost: number): number {
  return Math.round(cost * 1e6) / 1e6;
}

function onEveryFold(totals: Totals): Record<string, Totals> {
  return { traceSummary: totals, traceAnalytics: totals, analyticsRollup: totals };
}

describe("pricing Claude SDK spans", () => {
  describe("given two calls that write and then read a cached system prompt", () => {
    /** @scenario "Two calls that write and then read a cached prompt are priced once per token" */
    it("prices the fresh input, the cache write and the cache read once each", () => {
      const calls = [
        messagesCreate({
          spanId: "0411ce9051d31250",
          model: "claude-haiku-4-5",
          input: 15_232,
          output: 22,
          cacheWrite: 15_217,
          extra: { "anthropic.usage.cache_creation.ephemeral_5m_input_tokens": 15_217 },
        }),
        messagesCreate({
          spanId: "da331a1ae4055b61",
          model: "claude-haiku-4-5",
          input: 15_232,
          output: 22,
          cacheRead: 15_217,
        }),
      ];

      expect(pricedBy(calls)).toEqual(
        onEveryFold({
          cost: 0.020793,
          promptTokens: 30,
          completionTokens: 44,
          cacheReadTokens: 15_217,
          cacheWriteTokens: 15_217,
        }),
      );
    });
  });

  describe("given a call that read and wrote the cache", () => {
    /** @scenario "A GenAI convention span's cache write is priced at the catalogue cache-write rate" */
    it("prices each bucket at the catalogue rate for that bucket", () => {
      const call = messagesCreate({
        spanId: "aaaa000000000001",
        model: "claude-opus-4-7",
        input: 3000,
        output: 100,
        cacheRead: 500,
        cacheWrite: 2000,
      });

      // 500 x 5e-6 fresh, 500 x 5e-7 read, 2000 x 6.25e-6 write, 100 x 2.5e-5 out.
      expect(pricedBy([call])).toEqual(
        onEveryFold({
          cost: 0.01775,
          promptTokens: 500,
          completionTokens: 100,
          cacheReadTokens: 500,
          cacheWriteTokens: 2000,
        }),
      );
    });
  });

  describe("given a call whose cache writes all went to the one-hour cache", () => {
    /** @scenario "Anthropic one-hour cache writes are priced at the one-hour rate" */
    it("prices the writes at the one-hour rate", () => {
      const call = messagesCreate({
        spanId: "aaaa000000000002",
        model: "claude-opus-4-7",
        input: 2100,
        output: 50,
        cacheWrite: 2000,
        extra: {
          "anthropic.usage.cache_creation.ephemeral_5m_input_tokens": 0,
          "anthropic.usage.cache_creation.ephemeral_1h_input_tokens": 2000,
        },
      });

      // 100 x 5e-6 fresh, 2000 x 1e-5 one-hour write, 50 x 2.5e-5 out.
      expect(pricedBy([call])).toEqual(
        onEveryFold({
          cost: 0.02175,
          promptTokens: 100,
          completionTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 2000,
        }),
      );
    });
  });

  describe("given a token count request", () => {
    /** @scenario "A token count request is not usage" */
    it("adds no tokens and no cost", () => {
      const countTokens = sdkSpan({
        spanId: "aaaa000000000003",
        name: "anthropic.messages.count_tokens",
        attributes: {
          "gen_ai.provider.name": "anthropic",
          "gen_ai.request.model": "claude-opus-4-7",
          "anthropic.message.count_tokens.input_tokens": 1200,
        },
      });

      expect(pricedBy([countTokens])).toEqual(
        onEveryFold({
          cost: 0,
          promptTokens: 0,
          completionTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
    });
  });
});
