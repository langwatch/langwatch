import { createTenantId, FoldProjectionExecutor } from "@langwatch/eventing";
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { MAX_PROCESSED_SPANS, TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import {
  createInitState,
  createSpanReceivedEvent,
  createTestRuntime,
} from "./trace-summary-test.fixtures.ts";

/** Regression guard for the 2026-07-09 re-fold storm. Hot traces reach the fold
 * out of occurredAt order; the trace summary is order-insensitive, so spans fold
 * when they arrive without re-reading the event log. */

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

function buildProjection(store: FoldProjectionStore<TraceSummaryData>): TraceSummaryFoldProjection {
  return TraceSummaryFoldProjection.create({
    store,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
}

/** Past the cap the fold never reads `data`, so the span stays minimal. */
function spanEventAt(occurredAt: number, id: string): TraceProcessingEvent {
  return createSpanReceivedEvent({
    eventId: id,
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    spanId: id,
    name: "child",
    occurredAt,
  });
}

describe("TraceSummaryFoldProjection re-fold policy", () => {
  /** @scenario "The trace summary folds an earlier span without reading the event log" */
  it("folds a span that occurred before the checkpoint without reading the event log", async () => {
    const store: FoldProjectionStore<TraceSummaryData> = {
      tryGet: vi.fn().mockResolvedValue(stateWithSpanCount(MAX_PROCESSED_SPANS + 1)),
      store: vi.fn().mockResolvedValue(undefined),
    };
    const projection = buildProjection(store);
    const eventLoader = vi.fn().mockResolvedValue([]);
    projection.eventLoader = eventLoader;

    const result = await new FoldProjectionExecutor().execute(projection, spanEventAt(1_000, "a"), {
      aggregateId: TRACE_ID,
      tenantId: TENANT_ID,
    });

    expect(eventLoader).not.toHaveBeenCalled();
    expect(result.spanCount).toBe(MAX_PROCESSED_SPANS + 2);
  });

  describe("given a trace summary with spans already folded", () => {
    describe("when a batch of three earlier spans is folded", () => {
      /** @scenario "Folding out-of-order spans without a re-fold still counts every span" */
      it("skips the event-log replay, counts every span, and never rewinds the checkpoint", async () => {
        const stored = stateWithSpanCount(MAX_PROCESSED_SPANS + 10);
        let persisted: TraceSummaryData | undefined;
        const store: FoldProjectionStore<TraceSummaryData> = {
          tryGet: vi.fn().mockResolvedValue(stored),
          store: vi.fn(async (state: TraceSummaryData) => {
            persisted = state;
          }),
        };

        const projection = buildProjection(store);
        const eventLoader = vi.fn().mockResolvedValue([]);
        projection.eventLoader = eventLoader;

        // Every event occurred before the persisted checkpoint — exactly what a
        // sharded, parallel recordSpan produces.
        const result = await new FoldProjectionExecutor().executeBatch(
          projection,
          [spanEventAt(3_000, "a"), spanEventAt(1_000, "b"), spanEventAt(2_000, "c")],
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
