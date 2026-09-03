import { createTenantId } from "@langwatch/eventing";
import { FoldProjectionExecutor } from "@langwatch/eventing";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { TraceAnalyticsFoldProjection, type TraceAnalyticsData } from "../trace-derived.projection";
import { MAX_PROCESSED_SPANS } from "../trace-summary.projection";
import { createSpanReceivedEvent, createTestRuntime } from "./fixtures/trace-summary-test.fixtures";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";

/**
 * Regression guard for the 2026-07-09 re-fold storm, slim-fold edition. The
 * slim `trace-analytics` fold mirrors `trace-summary` and reuses the same
 * order-insensitive services, but shipped (ADR-034 Phase 2) WITHOUT
 * `refoldOnOutOfOrder: false`. A hot trace (a Claude Code session streams
 * 100k+ events into one aggregate) then re-folded its entire history on every
 * out-of-order batch, pinning the checkpoint and starving the queue
 * (observed 2026-07-10: one trace with 112k staged fold jobs draining at ~0).
 *
 * Spans are distributed and arrive in any order, so an earlier span is simply
 * folded when it arrives and the event log is never re-read.
 *
 * Was
 * `platform/app/src/server/event-sourcing/pipelines/trace-processing/projections/__tests__/traceAnalyticsRefoldPolicy.unit.test.ts`.
 * `TraceAnalyticsFoldProjection` now takes `traceCanonicalisation` and
 * `runtime` deps alongside `store` (`.create(...)`, not a bare constructor).
 *
 * See specs/trace-processing/hot-trace-fold-amplification.feature.
 */

const TENANT_ID = createTenantId("project-1");
const TRACE_ID = "trace-1";
const CHECKPOINT_MS = 9_000;

function buildProjection(
  store: FoldProjectionStore<TraceAnalyticsData>,
): TraceAnalyticsFoldProjection {
  return TraceAnalyticsFoldProjection.create({
    store,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
}

function stateWithSpanCount(spanCount: number): TraceAnalyticsData {
  const projection = buildProjection({ store: async () => {}, get: async () => null });
  return {
    ...projection.init(),
    traceId: TRACE_ID,
    spanCount,
    LastEventOccurredAt: CHECKPOINT_MS,
  };
}

/** Past the cap the fold never reads `data`, so the span stays minimal. */
function spanEventAt(occurredAt: number, id: string) {
  return createSpanReceivedEvent({
    eventId: id,
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    spanId: id,
    occurredAt,
  });
}

describe("TraceAnalyticsFoldProjection re-fold policy", () => {
  /** @scenario "The slim trace-analytics fold folds an earlier span without reading the event log" */
  it("folds a span that occurred before the checkpoint without reading the event log", async () => {
    const store: FoldProjectionStore<TraceAnalyticsData> = {
      get: vi.fn().mockResolvedValue(stateWithSpanCount(MAX_PROCESSED_SPANS + 1)),
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
});
