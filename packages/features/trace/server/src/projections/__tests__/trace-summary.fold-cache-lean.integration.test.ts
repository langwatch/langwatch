/**
 * What a trace carrying a 1 MB output leaves in the Redis fold cache
 * (packages/features/trace/specs/large-trace-blob-offload.feature, ADR-022).
 */

// The three modules that jointly bound the entry are the real ones: the
// projection lean, the trace-summary fold and the Redis-cached fold store.
// Only Redis and the durable store behind the cache are doubled, so a
// regression in any of the three turns this red.
import {
  createTenantId,
  decodeFoldCacheEntry,
  RedisCachedFoldStore,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import type { SpanReceivedEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  IO_PREVIEW_BYTES,
  TraceProjectionLeanService,
} from "../../services/trace-projection-lean.service.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./fixtures/trace-summary-test.fixtures.ts";

const TENANT_ID = createTenantId("tenant-fold-lean");
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ROOT_SPAN_ID = "b7ad6b7169203331";
const CHILD_SPAN_ID = "b7ad6b7169203332";
const KEY_PREFIX = "traceSummary";

/** A marker that exists only past the preview boundary. The preview is the
 *  first IO_PREVIEW_BYTES of the value, so finding this string anywhere in the
 *  entry means a raw payload leaked through. */
const PAST_PREVIEW_MARKER = "__PAST_THE_PREVIEW_BOUNDARY__";
const ONE_MB_OUTPUT = "o".repeat(1024 * 1024) + PAST_PREVIEW_MARKER;

/** The longest string anywhere in a decoded entry, in UTF-8 bytes. */
function longestStringBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, longestStringBytes(item)), 0);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce<number>(
      (max, item) => Math.max(max, longestStringBytes(item)),
      0,
    );
  }
  return 0;
}

/** The only Redis surface the store uses: GET and SET over strings. Typed as
 *  the store's own second constructor parameter rather than as ioredis's
 *  client, which this package does not depend on. */
type FoldCacheRedis = ConstructorParameters<typeof RedisCachedFoldStore<TraceSummaryData>>[1];

function redisDouble(): { redis: FoldCacheRedis; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const redis: FoldCacheRedis = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => {
      entries.set(key, value);
      return "OK";
    },
  } as FoldCacheRedis;
  return { redis, entries };
}

describe("given a trace whose span carries a 1 MB output value", () => {
  describe("when all spans of the trace are folded into the trace summary", () => {
    /** @scenario "Folding a trace with a 1 MB output keeps the Redis cache entry lean" */
    it("caches a preview per IO attribute, no events payload, and the reductions and winner-span pointers the next fold needs", async () => {
      const rootEvent = createSpanReceivedEvent({
        eventId: "evt-root",
        tenantId: String(TENANT_ID),
        traceId: TRACE_ID,
        spanId: ROOT_SPAN_ID,
        parentSpanId: null,
        name: "chat-completion",
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano: "1700000004000000000",
        attributes: {
          "langwatch.input": "Summarise the incident report.",
          "langwatch.output": ONE_MB_OUTPUT,
        },
      });
      const childEvent = createSpanReceivedEvent({
        eventId: "evt-child",
        tenantId: String(TENANT_ID),
        traceId: TRACE_ID,
        spanId: CHILD_SPAN_ID,
        parentSpanId: ROOT_SPAN_ID,
        name: "chat-completion",
        startTimeUnixNano: "1700000001000000000",
        endTimeUnixNano: "1700000003000000000",
        attributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": 120,
          "gen_ai.usage.output_tokens": 80,
        },
      });

      const durableWrites: TraceSummaryData[] = [];
      const durable: FoldProjectionStore<TraceSummaryData> = {
        store: async (state) => {
          durableWrites.push(state);
        },
        tryGet: async () => null,
      };
      const { redis, entries } = redisDouble();
      const store = new RedisCachedFoldStore<TraceSummaryData>(durable, redis, {
        keyPrefix: KEY_PREFIX,
      });
      const projection = TraceSummaryFoldProjection.create({
        store: durable,
        traceCanonicalisation: TraceCanonicalisationService.create(),
        runtime: createTestRuntime(),
      });

      let state = projection.init();
      for (const event of [rootEvent, childEvent]) {
        // The dispatch interposition: what the projection queue actually sees.
        const leaned = TraceProjectionLeanService.leanForProjection(event) as SpanReceivedEvent;
        state = projection.handleTraceSpanReceived(leaned, state);
      }
      await store.store(state, {
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        appliedEventIds: ["evt-root", "evt-child"],
      });

      const raw = entries.get(`fold:${KEY_PREFIX}:${String(TENANT_ID)}:${TRACE_ID}`);
      expect(raw).toBeDefined();
      const cached = decodeFoldCacheEntry<TraceSummaryData>(raw!).state;

      // At most a preview per IO attribute. The preview may append an ellipsis
      // at the codepoint boundary, so allow that much slack and nothing more —
      // a raw 1 MB value misses this by sixteen times.
      expect(cached.computedOutput).not.toBeNull();
      expect(Buffer.byteLength(cached.computedOutput!, "utf8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 8,
      );
      expect(cached.computedOutput).toContain("oooo");
      // No string anywhere in the entry, attributes included, busts the budget.
      expect(longestStringBytes(cached)).toBeLessThanOrEqual(IO_PREVIEW_BYTES + 8);
      expect(Buffer.byteLength(raw!, "utf8")).toBeLessThan(1024 * 1024);

      // No events payload: the collections that scale with span count are
      // derived from the stored spans at read time, never folded into the
      // cache, and no raw over-threshold value survives anywhere in the entry.
      expect(cached).not.toHaveProperty("events");
      expect(raw).not.toContain(PAST_PREVIEW_MARKER);

      // The reductions the next fold step accumulates onto.
      expect(cached.spanCount).toBe(2);
      expect(cached.totalPromptTokenCount).toBe(120);
      expect(cached.totalCompletionTokenCount).toBe(80);
      expect(cached.totalDurationMs).toBe(state.totalDurationMs);
      expect(cached.models).toEqual(state.models);

      // The winner-span pointers the next fold step compares against.
      expect(cached.traceId).toBe(TRACE_ID);
      expect(cached.outputFromRootSpan).toBe(state.outputFromRootSpan);
      expect(cached.outputSpanEndTimeMs).toBe(state.outputSpanEndTimeMs);
      expect(cached.outputSpanEndTimeMs).toBeGreaterThan(0);
      expect(cached.rootSpanStartTimeMs).toBe(state.rootSpanStartTimeMs);
      expect(cached.rootSpanType).toBe(state.rootSpanType);

      // The durable store still received the same state the cache holds.
      expect(durableWrites).toHaveLength(1);
    });
  });
});
