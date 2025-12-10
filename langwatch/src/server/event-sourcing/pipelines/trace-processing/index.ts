export { traceProcessingPipeline } from "./pipeline";

// Re-export types
export type { TraceProcessingEvent, SpanReceivedEvent } from "./schemas/events";
export type { RecordSpanCommandData, SpanData } from "./schemas/commands";
export type { TraceSummary, TraceSummaryData } from "./projections";
export type { SpanStorageProjection, SpanStorageData } from "./projections";

