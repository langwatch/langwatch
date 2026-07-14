import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { FoldProjectionExecutor } from "~/server/event-sourcing/projections/foldProjectionExecutor";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../traceAnalytics.foldProjection";
import { MAX_PROCESSED_SPANS } from "../traceSummary.foldProjection";

/**
 * Regression guard for the 2026-07-09 re-fold storm, slim-fold edition. The
 * slim `traceAnalytics` fold mirrors `traceSummary` and reuses the same
 * order-insensitive services, but shipped (ADR-034 Phase 2) WITHOUT
 * `refoldOnOutOfOrder: false`. A hot trace (a Claude Code session streams
 * 100k+ events into one aggregate) then re-folded its entire history on every
 * out-of-order batch, pinning the checkpoint and starving the queue
 * (observed 2026-07-10: one trace with 112k staged fold jobs draining at ~0).
 *
 * Spans are distributed and arrive in any order, so an earlier span is simply
 * folded when it arrives and the event log is never re-read.
 *
 * See specs/event-sourcing/hot-trace-fold-amplification.feature.
 */

const TENANT_ID = createTenantId("project-1");
const TRACE_ID = "trace-1";
const CHECKPOINT_MS = 9_000;

function stateWithSpanCount(spanCount: number): TraceAnalyticsData {
  const projection = new TraceAnalyticsFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
  return {
    ...projection.init(),
    traceId: TRACE_ID,
    spanCount,
    LastEventOccurredAt: CHECKPOINT_MS,
  };
}

/**
 * Minimal but decodable span: the fold normalizes every span (no processing
 * cap), so the fixture carries the OTLP time/status fields decode requires.
 * Mirrors traceSummaryRefoldPolicy.unit.test.ts.
 */
function spanEventAt(occurredAt: number, id: string): TraceProcessingEvent {
  return {
    id,
    type: SPAN_RECEIVED_EVENT_TYPE,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: TENANT_ID,
    occurredAt,
    createdAt: occurredAt,
    version: "2025-12-17",
    data: {
      span: {
        name: "child",
        spanId: id,
        traceId: TRACE_ID,
        startTimeUnixNano: String(occurredAt * 1_000_000),
        endTimeUnixNano: String((occurredAt + 10) * 1_000_000),
        status: { code: 0 },
        attributes: [],
        events: [],
        links: [],
      },
      resource: {},
      instrumentationScope: { name: "test", version: null },
    },
  } as unknown as TraceProcessingEvent;
}

describe("TraceAnalyticsFoldProjection re-fold policy", () => {
  /** @scenario "The slim trace-analytics fold folds an earlier span without reading the event log" */
  it("folds a span that occurred before the checkpoint without reading the event log", async () => {
    const store: FoldProjectionStore<TraceAnalyticsData> = {
      get: vi
        .fn()
        .mockResolvedValue(stateWithSpanCount(MAX_PROCESSED_SPANS + 1)),
      store: vi.fn().mockResolvedValue(undefined),
    };
    const projection = new TraceAnalyticsFoldProjection({ store });
    const eventLoader = vi.fn().mockResolvedValue([]);
    projection.eventLoader = eventLoader;

    const result = await new FoldProjectionExecutor().execute(
      projection,
      spanEventAt(1_000, "a"),
      { aggregateId: TRACE_ID, tenantId: TENANT_ID },
    );

    expect(eventLoader).not.toHaveBeenCalled();
    expect(result.spanCount).toBe(MAX_PROCESSED_SPANS + 2);
  });

  describe("given a slim trace-analytics state with spans already folded", () => {
    describe("when a batch of three earlier spans is folded", () => {
      /** @scenario "Folding out-of-order spans without a re-fold still counts every span" */
      it("skips the event-log replay, counts every span, and never rewinds the checkpoint", async () => {
        const stored = stateWithSpanCount(MAX_PROCESSED_SPANS + 10);
        let persisted: TraceAnalyticsData | undefined;
        const store: FoldProjectionStore<TraceAnalyticsData> = {
          get: vi.fn().mockResolvedValue(stored),
          store: vi.fn(async (state: TraceAnalyticsData) => {
            persisted = state;
          }),
        };

        const projection = new TraceAnalyticsFoldProjection({ store });
        const eventLoader = vi.fn().mockResolvedValue([]);
        projection.eventLoader = eventLoader;

        // Every event occurred before the persisted checkpoint — exactly what a
        // sharded, parallel recordSpan produces for a hot trace.
        const result = await new FoldProjectionExecutor().executeBatch(
          projection,
          [
            spanEventAt(3_000, "a"),
            spanEventAt(1_000, "b"),
            spanEventAt(2_000, "c"),
          ],
          { aggregateId: TRACE_ID, tenantId: TENANT_ID },
        );

        expect(eventLoader).not.toHaveBeenCalled();
        expect(result.spanCount).toBe(MAX_PROCESSED_SPANS + 13);
        expect(persisted?.spanCount).toBe(MAX_PROCESSED_SPANS + 13);
        // The checkpoint is a high-water mark: folding older spans never rewinds it.
        expect(result.LastEventOccurredAt).toBe(CHECKPOINT_MS);
      });
    });
  });
});
