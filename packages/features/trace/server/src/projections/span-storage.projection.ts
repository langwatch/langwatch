import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { type SpanReceivedEvent, spanReceivedEventSchema } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { TraceSpanNormalizationPort } from "../ports/trace-span-normalization.port";
import { SpanCostService } from "../services/span-cost.service";
import {
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "../services/trace-span-storage-group.rules";

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
  private readonly spanNormalization: TraceSpanNormalizationPort;
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
    spanNormalization: TraceSpanNormalizationPort;
  }) {
    super();
    this.store = deps.store;
    this.spanCostService = deps.spanCostService;
    this.spanNormalization = deps.spanNormalization;
  }

  static create(deps: {
    store: AppendStore<NormalizedSpan>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalizationPort;
  }): SpanStorageMapProjection {
    return new SpanStorageMapProjection(deps);
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): NormalizedSpan {
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
