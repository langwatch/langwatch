import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { deriveSpanCost } from "./services/span-cost.derivation";
import { SpanCostService } from "./services/span-cost.service";

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

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
  protected readonly events = spanEvents;

  override options = {
    groupKeyFn: (event: { id: string }) => `span:${event.id}`,
  };

  constructor(deps: { store: AppendStore<NormalizedSpan> }) {
    super();
    this.store = deps.store;
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): NormalizedSpan {
    const span = spanNormalizationPipelineService.normalizeSpanReceived(
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
