/**
 * Fold-cache leanness for a trace carrying a 1 MB IO value
 * (specs/event-sourcing/large-trace-blob-offload.feature — Track 1, ADR-022).
 *
 * Composes the real production modules that jointly bound the Redis entry:
 *
 *   1. `leanForProjection` — the dispatch interposition
 *      (eventSourcingService, between storeEvents and router.dispatch). It
 *      replaces over-threshold IO attribute values with a UTF-8-safe
 *      IO_PREVIEW_BYTES preview before the event reaches the projection queue,
 *      so the fold never sees the 1 MB value in the first place.
 *   2. `TraceSummaryFoldProjection` — folds the leaned spans into the summary.
 *      Span-count-scaling collections (events[], span costs, scenario role
 *      maps) are deliberately NOT accumulated; they are derived from
 *      stored_spans at read time.
 *   3. `RedisCachedFoldStore` + `encodeFoldCacheEntry` — writes the entry at
 *      `fold:<prefix>:<tenantId>:<traceId>`.
 *
 * Only boundaries are doubled: Redis (a string GET/SET map — the whole of the
 * store's Redis surface) and the durable ClickHouse fold store. Every module
 * whose behaviour the scenario describes is the real one, so a regression in
 * any of the three turns this red.
 */

import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import {
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "~/server/app-layer/traces/lean-for-projection";
import type { TraceSummaryData } from "~/server/domain/traces/types";
import type { Event } from "~/server/event-sourcing";
import { createTenantId } from "~/server/event-sourcing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { TraceSummaryFoldProjection } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { SpanReceivedEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { FoldProjectionStore } from "../../foldProjection.types";
import { RedisCachedFoldStore } from "../../redisCachedFoldStore";
import { decodeFoldCacheEntry } from "../foldCacheEntry";

const TENANT_ID = createTenantId("tenant-fold-lean");
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ROOT_SPAN_ID = "b7ad6b7169203331";
const CHILD_SPAN_ID = "b7ad6b7169203332";
const KEY_PREFIX = "traceSummary";

/**
 * Marker that only exists past the 64 KB preview boundary. The preview is
 * `value.slice(0, 64 KB) + "…"`, so this string can NEVER survive leaning —
 * finding it anywhere in the cache entry means a raw payload leaked through.
 */
const PAST_PREVIEW_MARKER = "__PAST_THE_PREVIEW_BOUNDARY__";
const ONE_MB_OUTPUT = "o".repeat(1024 * 1024) + PAST_PREVIEW_MARKER;

/** Longest string anywhere in a decoded entry, in UTF-8 bytes. */
function longestStringBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Array.isArray(value))
    return value.reduce<number>(
      (max, item) => Math.max(max, longestStringBytes(item)),
      0,
    );
  if (value !== null && typeof value === "object")
    return Object.values(value).reduce<number>(
      (max, item) => Math.max(max, longestStringBytes(item)),
      0,
    );
  return 0;
}

function makeSpanReceivedEvent({
  eventId,
  spanId,
  parentSpanId,
  spanAttributes,
  startTimeUnixNano,
  endTimeUnixNano,
}: {
  eventId: string;
  spanId: string;
  parentSpanId: string | null;
  spanAttributes: Record<string, string>;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
}): Event {
  return {
    id: eventId,
    aggregateId: TRACE_ID,
    aggregateType: "trace" as const,
    tenantId: TENANT_ID,
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: {
        traceId: TRACE_ID,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
        name: "chat-completion",
        kind: 1,
        startTimeUnixNano,
        endTimeUnixNano,
        attributes: Object.entries(spanAttributes).map(([key, value]) => ({
          key,
          value: { stringValue: value },
        })),
        events: [],
        links: [],
        status: { code: 1, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId, traceId: TRACE_ID },
  };
}

/** In-memory stand-in for the only Redis surface the store uses: GET / SET. */
function createRedisDouble(): { redis: Redis; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const redis = {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: string) {
      entries.set(key, value);
      return "OK";
    },
  } as unknown as Redis;
  return { redis, entries };
}

describe("given a trace whose span carries a 1 MB output value", () => {
  describe("when all spans of the trace are folded into the trace summary", () => {
    /** @scenario Folding a trace with a 1 MB output keeps the Redis cache entry lean */
    it("caches only a 64 KB preview per IO attr, no events payload, and the reductions and winner-span pointers the next fold needs", async () => {
      const rootEvent = makeSpanReceivedEvent({
        eventId: "evt-root",
        spanId: ROOT_SPAN_ID,
        parentSpanId: null,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano: "1700000004000000000",
        spanAttributes: {
          "langwatch.input": "Summarise the incident report.",
          "langwatch.output": ONE_MB_OUTPUT,
        },
      });
      const childEvent = makeSpanReceivedEvent({
        eventId: "evt-child",
        spanId: CHILD_SPAN_ID,
        parentSpanId: ROOT_SPAN_ID,
        startTimeUnixNano: "1700000001000000000",
        endTimeUnixNano: "1700000003000000000",
        spanAttributes: {
          "langwatch.span.type": "llm",
          "gen_ai.request.model": "gpt-5-mini",
          "gen_ai.response.model": "gpt-5-mini",
          "gen_ai.usage.input_tokens": "120",
          "gen_ai.usage.output_tokens": "80",
        },
      });

      const durableWrites: TraceSummaryData[] = [];
      const durable: FoldProjectionStore<TraceSummaryData> = {
        async store(state) {
          durableWrites.push(state);
        },
        async get() {
          return null;
        },
      };
      const { redis, entries } = createRedisDouble();
      const store = new RedisCachedFoldStore<TraceSummaryData>(
        durable,
        redis,
        { keyPrefix: KEY_PREFIX },
      );
      const projection = new TraceSummaryFoldProjection({ store: durable });

      let state = projection.init();
      for (const event of [rootEvent, childEvent]) {
        // The dispatch interposition: what the projection queue actually sees.
        const leaned = leanForProjection(event) as SpanReceivedEvent;
        state = projection.handleTraceSpanReceived(leaned, state);
      }
      await store.store(state, {
        aggregateId: TRACE_ID,
        tenantId: TENANT_ID,
        appliedEventIds: ["evt-root", "evt-child"],
      });

      const key = `fold:${KEY_PREFIX}:${String(TENANT_ID)}:${TRACE_ID}`;
      const raw = entries.get(key);
      expect(raw).toBeDefined();
      const cached = decodeFoldCacheEntry<TraceSummaryData>(raw!).state;

      // Then: at most a 64 KB preview per IO attr. The preview appends a single
      // "…" (3 bytes) at the codepoint boundary, so allow that much slack and
      // nothing more — a raw 1 MB value would miss this by 16x.
      expect(cached.computedOutput).not.toBeNull();
      expect(Buffer.byteLength(cached.computedOutput!, "utf8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 8,
      );
      expect(cached.computedOutput).toContain("oooo");
      // No string anywhere in the entry — attributes included — busts the budget.
      expect(longestStringBytes(cached)).toBeLessThanOrEqual(IO_PREVIEW_BYTES + 8);
      expect(Buffer.byteLength(raw!, "utf8")).toBeLessThan(1024 * 1024);

      // Then: no events[] payload. The span-count-scaling collections are
      // derived from stored_spans at read time, never folded into the cache,
      // and no raw over-threshold value survives anywhere in the entry.
      expect(cached).not.toHaveProperty("events");
      expect(raw).not.toContain(PAST_PREVIEW_MARKER);

      // Then: the reductions the next fold step accumulates onto.
      expect(cached.spanCount).toBe(2);
      expect(cached.totalPromptTokenCount).toBe(120);
      expect(cached.totalCompletionTokenCount).toBe(80);
      expect(cached.totalDurationMs).toBe(state.totalDurationMs);
      expect(cached.models).toEqual(state.models);

      // Then: the winner-span pointers the next fold step compares against.
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
