import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { FoldProjectionExecutor } from "~/server/event-sourcing/projections/foldProjectionExecutor";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import { createInitState } from "./fixtures/trace-summary-test.fixtures";

/**
 * Regression guard for the 2026-07-09 re-fold storm. Sharding recordSpan across
 * GroupQueue lanes makes a hot trace's spans reach the fold out of occurredAt
 * order, so the executor's out-of-order detector fires constantly. The trace
 * summary is order-insensitive, so a span is simply folded when it arrives and
 * the event log is never re-read.
 *
 * See specs/event-sourcing/hot-trace-fold-amplification.feature.
 */

const TENANT_ID = createTenantId("project-1");
const TRACE_ID = "trace-1";
const CHECKPOINT_MS = 9_000;

function stateWithSpanCount(spanCount: number): TraceSummaryData {
  return {
    ...createInitState(),
    traceId: TRACE_ID,
    spanCount,
    LastEventOccurredAt: CHECKPOINT_MS,
  } as TraceSummaryData;
}

/**
 * Derivation is no longer capped, so every span IS normalized — the fixture has
 * to carry real timestamps rather than relying on the old short-circuit.
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

/** A trace far bigger than any old processing cap — derivation no longer stops. */
const LARGE_TRACE_SPAN_COUNT = 512;

describe("TraceSummaryFoldProjection re-fold policy", () => {
  /** @scenario "The trace summary folds an earlier span without reading the event log" */
  it("folds a span that occurred before the checkpoint without reading the event log", async () => {
    const store: FoldProjectionStore<TraceSummaryData> = {
      get: vi.fn().mockResolvedValue(stateWithSpanCount(LARGE_TRACE_SPAN_COUNT + 1)),
      store: vi.fn().mockResolvedValue(undefined),
    };
    const projection = new TraceSummaryFoldProjection({ store });
    const eventLoader = vi.fn().mockResolvedValue([]);
    projection.eventLoader = eventLoader;

    const result = await new FoldProjectionExecutor().execute(
      projection,
      spanEventAt(1_000, "a"),
      { aggregateId: TRACE_ID, tenantId: TENANT_ID },
    );

    expect(eventLoader).not.toHaveBeenCalled();
    expect(result.spanCount).toBe(LARGE_TRACE_SPAN_COUNT + 2);
  });

  describe("given a trace summary with spans already folded", () => {
    describe("when a batch of three earlier spans is folded", () => {
      /** @scenario "Folding out-of-order spans without a re-fold still counts every span" */
      it("skips the event-log replay, counts every span, and never rewinds the checkpoint", async () => {
        const stored = stateWithSpanCount(LARGE_TRACE_SPAN_COUNT + 10);
        let persisted: TraceSummaryData | undefined;
        const store: FoldProjectionStore<TraceSummaryData> = {
          get: vi.fn().mockResolvedValue(stored),
          store: vi.fn(async (state: TraceSummaryData) => {
            persisted = state;
          }),
        };

        const projection = new TraceSummaryFoldProjection({ store });
        const eventLoader = vi.fn().mockResolvedValue([]);
        projection.eventLoader = eventLoader;

        // Every event occurred before the persisted checkpoint — exactly what a
        // sharded, parallel recordSpan produces.
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
        expect(result.spanCount).toBe(LARGE_TRACE_SPAN_COUNT + 13);
        expect(persisted?.spanCount).toBe(LARGE_TRACE_SPAN_COUNT + 13);
        // The checkpoint is a high-water mark: folding older spans never rewinds it.
        expect(result.LastEventOccurredAt).toBe(CHECKPOINT_MS);
      });
    });
  });
});
