/**
 * Unit tests for `TraceAnalyticsRollupMapProjection.mapTraceSpanReceived`.
 *
 * The rollup is a TRACE-level aggregate assembled from per-span increments, so
 * every extraction it performs must match what `SpanCostService.accumulateTokens`
 * feeds the trace-summary fold. Anything it derives independently is a silent
 * divergence between `sum(trace_analytics_rollup.CostSum)` and
 * `sum(trace_summaries.TotalCost)` — and the rollup exists only to answer that
 * same question faster.
 */

import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../schemas/otlp";
import type { SpanReceivedEvent } from "../../schemas/events";
import { TraceAnalyticsRollupMapProjection } from "../traceAnalyticsRollup.mapProjection";
import type { TraceAnalyticsRollupRow } from "../traceAnalyticsRollup.mapProjection";

interface SpanOptions {
  parentSpanId?: string | null;
  attributes?: Record<string, string | number | boolean>;
  statusCode?: number | null;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
}

function otlpAttr(key: string, value: string | number | boolean) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: value } };
}

function makeSpanReceivedEvent(options: SpanOptions = {}): SpanReceivedEvent {
  const span = {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: options.parentSpanId ?? null,
    name: "llm-call",
    kind: 1,
    // 1_700_000_000_000 ms → floors to the 1_700_000_000_000 minute boundary
    // only if already aligned; use an offset so the flooring is observable.
    startTimeUnixNano: options.startTimeUnixNano ?? "1700000000500000000",
    endTimeUnixNano: options.endTimeUnixNano ?? "1700000002500000000",
    attributes: Object.entries(options.attributes ?? {}).map(([k, v]) =>
      otlpAttr(k, v),
    ),
    events: [],
    links: [],
    status: { code: options.statusCode ?? null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;

  return {
    id: "evt-1",
    type: "span.received",
    tenantId: "tenant-1",
    aggregateId: "aaaa0000000000000000000000000001",
    data: {
      span,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId: "bbbb000000000001", traceId: "trace-1" },
  } as unknown as SpanReceivedEvent;
}

function mapRow(options: SpanOptions = {}): TraceAnalyticsRollupRow {
  const projection = new TraceAnalyticsRollupMapProjection({
    store: { append: async () => {}, appendBatch: async () => {} } as never,
  });
  return projection.mapTraceSpanReceived(makeSpanReceivedEvent(options));
}

describe("TraceAnalyticsRollupMapProjection.mapTraceSpanReceived", () => {
  describe("given a span carrying both request and response models", () => {
    it("keys the row on the response model (SpanCostService precedence)", () => {
      const row = mapRow({
        attributes: {
          "gen_ai.request.model": "gpt-4o-mini",
          "gen_ai.response.model": "gpt-4o-2024-08-06",
        },
      });
      expect(row.model).toBe("gpt-4o-2024-08-06");
    });
  });

  describe("given a span carrying only a request model", () => {
    it("falls back to the request model", () => {
      const row = mapRow({ attributes: { "gen_ai.request.model": "claude-3" } });
      expect(row.model).toBe("claude-3");
    });
  });

  describe("given a span carrying no model at all", () => {
    it("keys the row on the empty-model bucket", () => {
      expect(mapRow().model).toBe("");
    });
  });

  describe("given a root span", () => {
    it("counts one trace and carries the wall-clock duration", () => {
      const row = mapRow({ parentSpanId: null });
      expect(row.traceCount).toBe(1);
      expect(row.durationSum).toBe(2000);
      expect(row.spanCount).toBe(1);
    });

    it("counts an error only when the root span's status is ERROR", () => {
      expect(mapRow({ parentSpanId: null, statusCode: 2 }).errorCount).toBe(1);
      expect(mapRow({ parentSpanId: null, statusCode: 1 }).errorCount).toBe(0);
    });
  });

  describe("given a child span", () => {
    it("contributes no trace count and no duration", () => {
      const row = mapRow({ parentSpanId: "bbbb000000000000" });
      expect(row.traceCount).toBe(0);
      expect(row.durationSum).toBe(0);
      expect(row.spanCount).toBe(1);
    });

    it("never counts an error, even on an ERROR status", () => {
      const row = mapRow({
        parentSpanId: "bbbb000000000000",
        statusCode: 2,
      });
      expect(row.errorCount).toBe(0);
    });
  });

  describe("given a span whose bucket start is mid-minute", () => {
    it("floors BucketStart to the minute", () => {
      const row = mapRow({ startTimeUnixNano: "1700000000500000000" });
      expect(row.bucketStart.getTime() % 60_000).toBe(0);
      expect(row.bucketStart.getTime()).toBe(
        Math.floor(1_700_000_000_500 / 60_000) * 60_000,
      );
    });
  });

  describe("given token usage attributes", () => {
    it("reads prompt/completion/cache/reasoning tokens via SpanCostService", () => {
      const row = mapRow({
        attributes: {
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 20,
          "gen_ai.usage.cache_read.input_tokens": 7,
          "gen_ai.usage.cache_creation.input_tokens": 3,
          "gen_ai.usage.reasoning_tokens": 5,
        },
      });
      expect(row.promptTokensSum).toBe(100);
      expect(row.completionTokensSum).toBe(20);
      expect(row.cacheReadTokensSum).toBe(7);
      expect(row.cacheWriteTokensSum).toBe(3);
      expect(row.reasoningTokensSum).toBe(5);
    });

    // Regression: the mapper used to read only
    // `gen_ai.usage.cache_read_input_tokens`, while SpanCostService.extractCacheTokens
    // falls back to `gen_ai.usage.cached_tokens`. Emitters using the fallback key
    // contributed 0 to the rollup but a real number to trace_summaries.
    it("honours the gen_ai.usage.cached_tokens fallback for cache reads", () => {
      const row = mapRow({
        attributes: { "gen_ai.usage.cached_tokens": 42 },
      });
      expect(row.cacheReadTokensSum).toBe(42);
    });
  });

  describe("given a span flagged skip_token_accumulation", () => {
    // Regression: this marker means the span's usage is a redundant copy of
    // another span's (e.g. codex's response span echoing the turn rollup).
    // `SpanCostService.accumulateTokens` zeroes it so the TRACE total counts the
    // usage once. The rollup is a trace-level aggregate, so it must do the same
    // — otherwise ungrouped sum(tokens)/sum(cost) double-count those traces.
    const skipped = {
      "langwatch.reserved.skip_token_accumulation": "true",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 20,
      "gen_ai.usage.cache_read.input_tokens": 7,
      "gen_ai.usage.cache_creation.input_tokens": 3,
      "gen_ai.usage.reasoning_tokens": 5,
    };

    it("contributes zero tokens", () => {
      const row = mapRow({ attributes: skipped });
      expect(row.promptTokensSum).toBe(0);
      expect(row.completionTokensSum).toBe(0);
      expect(row.cacheReadTokensSum).toBe(0);
      expect(row.cacheWriteTokensSum).toBe(0);
      expect(row.reasoningTokensSum).toBe(0);
    });

    it("contributes zero cost", () => {
      const row = mapRow({ attributes: skipped });
      expect(row.costSum).toBe(0);
      expect(row.nonBilledCostSum).toBe(0);
    });

    it("still counts the span itself", () => {
      expect(mapRow({ attributes: skipped }).spanCount).toBe(1);
    });
  });

  describe("given an unflagged span with the same usage", () => {
    it("does contribute its tokens (the marker is what suppresses them)", () => {
      const row = mapRow({
        attributes: {
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 20,
        },
      });
      expect(row.promptTokensSum).toBe(100);
      expect(row.completionTokensSum).toBe(20);
    });
  });
});
