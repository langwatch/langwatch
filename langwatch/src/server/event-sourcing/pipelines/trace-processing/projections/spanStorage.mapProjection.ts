import { SpanNormalizationPipelineService, enrichRagContextIds } from "~/server/app-layer/traces/span-normalization.service";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import type { AppendStore, MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

/**
 * Creates a MapProjection definition for span storage.
 *
 * Extracts the pure mapping logic from SpanStorageEventHandler.
 * Maps a SpanReceivedEvent to a NormalizedSpan for storage.
 * The framework handles dispatch and persistence via the AppendStore.
 */
export function createSpanStorageMapProjection({
  store,
}: {
  store: AppendStore<NormalizedSpan>;
}): MapProjectionDefinition<NormalizedSpan, SpanReceivedEvent> {
  return {
    name: "spanStorage",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],

    options: {
      groupKeyFn: (event: SpanReceivedEvent) => `span:${event.id}`,
    },

    map(event: SpanReceivedEvent): NormalizedSpan {
      const span = spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
      enrichRagContextIds(span);
      return span;
    },

    store,
  };
}
