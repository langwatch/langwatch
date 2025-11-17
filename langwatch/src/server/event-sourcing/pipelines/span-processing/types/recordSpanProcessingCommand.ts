import type { SpanData } from "./spanData";

/**
 * Command data for recording a span processing.
 */
export interface RecordSpanProcessingCommandData {
  spanData: SpanData;
  collectedAtUnixMs: number;
}
