import type { AppendStore, MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";

const spanNormalizationPipelineService = new SpanNormalizationPipelineService();

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

    map(event: SpanReceivedEvent): NormalizedSpan {
      return spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    },

    store,
  };
}
