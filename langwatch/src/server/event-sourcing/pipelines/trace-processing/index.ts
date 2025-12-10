export { traceProcessingPipeline } from "./pipeline";
export type {
  SpanStorageData,
  SpanStorageProjection,
  TraceSummary,
  TraceSummaryData,
} from "./projections";
export type { RecordSpanCommandData, SpanData } from "./schemas/commands";
// Re-export types
export type { SpanReceivedEvent, TraceProcessingEvent } from "./schemas/events";
