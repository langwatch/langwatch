import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  type NormalizedSpan,
} from "@langwatch/trace-contract";

import { type TraceSpanNormalization } from "../app/trace.members.ts";
import { spanStorabilityOf, UNSTORABLE_SPAN_SKIPPED } from "../rules/storable-span-time.rules.ts";
import {
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "../rules/trace-span-storage-group.rules.ts";
import type { SpanCostService } from "../services/span-cost.service.ts";

const logger = createLogger("langwatch:trace-processing:span-storage-map");

const spanEvents = [spanReceivedEventSchema] as const;

/**
 * Map projection that transforms SpanReceivedEvents into NormalizedSpans.
 * Extracts the pure mapping logic from SpanStorageEventHandler.
 * The framework handles dispatch and persistence via the AppendStore.
 */
export class SpanStorageMapProjection
  extends AbstractMapProjection<NormalizedSpan, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, NormalizedSpan>
{
  readonly name = "spanStorage";
  readonly store: AppendStore<NormalizedSpan>;
  private readonly spanCostService: SpanCostService;
  private readonly spanNormalization: TraceSpanNormalization;
  protected readonly events = spanEvents;

  override options = {
    // Shard-keyed lanes + coalescing (ADR-066): same span → same lane
    // (redeliveries serialize), backed-up lanes drain in 256-event
    // bulkAppend bites instead of one queue job per span. See
    // spanStorageGroupKey.ts for the measured rationale.
    groupKeyFn: spanStorageMapGroupKey,
    coalesceMaxBatch: TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
  };

  private constructor(deps: {
    store: AppendStore<NormalizedSpan>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }) {
    super();
    this.store = deps.store;
    this.spanCostService = deps.spanCostService;
    this.spanNormalization = deps.spanNormalization;
  }

  static create(deps: {
    store: AppendStore<NormalizedSpan>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }): SpanStorageMapProjection {
    return new SpanStorageMapProjection(deps);
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): NormalizedSpan | null {
    // Before normalization, where an unstorable time throws (the record id is a
    // KSUID over its start seconds); skipping keeps one span from blocking the lane.
    const storability = spanStorabilityOf({ event, consumer: this.name });
    if (!storability.storable) {
      logger.warn(storability.skip, UNSTORABLE_SPAN_SKIPPED);
      return null;
    }

    const span = this.spanNormalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    this.spanNormalization.enrichRagContextIds(span);
    // Compute the per-span cost the same way the trace-summary fold does (same
    // SpanCostService, run on the same normalized span the fold sees) so the
    // stored Cost / NonBilledCost match the span's contribution to the trace
    // total.
    const { cost, nonBilledCost } = this.spanCostService.deriveStorageCost(span);
    span.cost = cost;
    span.nonBilledCost = nonBilledCost;
    return span;
  }
}
