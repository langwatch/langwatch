import type { SpanData } from "./spanData";

/**
 * Command data for storing a span ingestion.
 * This command writes the span to persistent storage and stores the ingestion event.
 */
export interface StoreSpanIngestionCommandData {
  tenantId: string;
  spanData: SpanData;
  collectedAtUnixMs: number;
}
