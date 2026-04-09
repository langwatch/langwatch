import { SpanNormalizationPipelineService, enrichRagContextIds } from "~/server/app-layer/traces/span-normalization.service";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { AbstractMapProjection, type MapEventHandlers } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { spanReceivedEventSchema, type SpanReceivedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

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
    return span;
  }
}
