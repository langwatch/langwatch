import type { MapProjectionDefinition } from "../../../library/projections/mapProjection.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import { SpanNormalizationPipelineService } from "../services/spanNormalizationPipelineService";
import { spanAppendStore } from "../repositories/spanAppendStore";

const spanNormalizationPipelineService = new SpanNormalizationPipelineService();

/**
 * MapProjection definition for span storage.
 *
 * Extracts the pure mapping logic from SpanStorageEventHandler.
 * Maps a SpanReceivedEvent to a NormalizedSpan for storage.
 * The framework handles dispatch and persistence via the AppendStore.
 */
export const spanStorageMapProjection: MapProjectionDefinition<
  NormalizedSpan,
  SpanReceivedEvent
> = {
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

  store: spanAppendStore,
};
