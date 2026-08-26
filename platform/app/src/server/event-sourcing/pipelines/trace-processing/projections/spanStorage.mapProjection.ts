import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { type SpanReceivedEvent, spanReceivedEventSchema } from "../schemas/events";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { deriveSpanCost } from "./services/span-cost.derivation";
import { SpanCostService } from "./services/span-cost.service";
import {
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "./spanStorageGroupKey";

const spanCostService = new SpanCostService();

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
  private readonly spanNormalizationPipelineService: SpanNormalizationPipelineService;
  protected readonly events = spanEvents;

  override options = {
    // Shard-keyed lanes + coalescing (ADR-066): same span → same lane
    // (redeliveries serialize), backed-up lanes drain in 256-event
    // bulkAppend bites instead of one queue job per span. See
    // spanStorageGroupKey.ts for the measured rationale.
    groupKeyFn: spanStorageMapGroupKey,
    coalesceMaxBatch: TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
  };

  constructor(deps: {
    store: AppendStore<NormalizedSpan>;
    traceCanonicalisation: TraceCanonicalisationService;
  }) {
    super();
    this.store = deps.store;
    this.spanNormalizationPipelineService = new SpanNormalizationPipelineService(
      deps.traceCanonicalisation,
    );
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): NormalizedSpan {
    const span = this.spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    enrichRagContextIds(span);
    // Compute the per-span cost the same way the trace-summary fold does (same
    // SpanCostService, run on the same normalized span the fold sees) so the
    // stored Cost / NonBilledCost match the span's contribution to the trace
    // total.
    const { cost, nonBilledCost } = deriveSpanCost({ span, spanCostService });
    span.cost = cost;
    span.nonBilledCost = nonBilledCost;
    return span;
  }
}
