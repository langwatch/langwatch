import { createTenantId, FoldProjectionExecutor } from "@langwatch/eventing";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
} from "../trace-derived.projection.ts";
import { MAX_PROCESSED_SPANS } from "../trace-summary.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./trace-summary-test.fixtures.ts";

/** Regression guard for the 2026-07-09 re-fold storm. The slim trace-analytics
 * fold shipped without refoldOnOutOfOrder: false, causing hot traces to re-fold
 * on every out-of-order batch. Now it reuses order-insensitive services. */

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
  const projection = buildProjection({
    store: async () => {},
    get: async () => ({ kind: "empty" as const }),
  });
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
      get: vi
        .fn()
        .mockResolvedValue({ kind: "folded", state: stateWithSpanCount(MAX_PROCESSED_SPANS + 1) }),
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
