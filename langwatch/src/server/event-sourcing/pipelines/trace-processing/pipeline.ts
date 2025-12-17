import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { SpanStorageEventHandler } from "./handlers";
import { TraceSummaryProjectionHandler } from "./projections";
import type { TraceProcessingEvent } from "./schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "./schemas/constants";

/**
 * Trace processing pipeline for computing trace summaries and storing spans.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics and writes individual
 * spans to the stored_spans table via an event handler.
 */
export const traceProcessingPipeline = eventSourcing
  .registerPipeline<TraceProcessingEvent>()
  .withName("trace_processing")
  .withAggregateType("trace")
  .withProjection("traceSummary", TraceSummaryProjectionHandler, {
    // This reduces strain of computationally heavy trace summary projections being done
    // unnecessarily due to the burst-heavy nature of span collection.
    debounceMs: 1000,
  })
  .withEventHandler("spanStorage", SpanStorageEventHandler, {
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
  })
  .withCommand("recordSpan", RecordSpanCommand)
  .build();
