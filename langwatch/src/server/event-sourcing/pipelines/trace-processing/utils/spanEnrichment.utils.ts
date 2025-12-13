import type { PureSpanData, SpanData } from "../schemas/commands";
import type { SpanReceivedEvent } from "../schemas/events";
import { generateDeterministicSpanRecordId } from "./id.utils";

/**
 * Enriches pure span data with computed fields for storage and processing.
 *
 * Adds system-generated fields that are not part of the user input:
 * - id: Deterministic KSUID for the span record
 * - aggregateId: Set to traceId for event stream aggregation
 * - tenantId: Derived from event context
 *
 * @param pureSpanData - The pure span data from the event (user input only)
 * @param event - The SpanReceivedEvent containing context
 * @returns Enriched span data with computed fields
 *
 * @example
 * ```typescript
 * const enrichedSpanData = enrichSpanData(event.data.spanData, event);
 * await spanRepository.insertSpan({ spanData: enrichedSpanData, ... });
 * ```
 */
function enrichSpanData(
  pureSpanData: PureSpanData,
  event: SpanReceivedEvent,
): SpanData {
  return {
    ...pureSpanData,
    id: generateDeterministicSpanRecordId(event),
    aggregateId: pureSpanData.traceId,
    tenantId: String(event.tenantId),
  };
}

export const SpanEnrichmentUtils = {
  enrichSpanData,
} as const;
