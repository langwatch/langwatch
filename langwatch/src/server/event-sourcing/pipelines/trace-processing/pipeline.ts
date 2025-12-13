import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { SpanStorageEventHandler } from "./handlers";
import { TraceSummaryProjectionHandler } from "./projections";
import type { TraceSummary } from "./projections/traceSummaryProjection";
import type { TraceProcessingEvent } from "./schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "./schemas/events";

/**
 * Trace processing pipeline for computing trace summaries and storing spans.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics and writes individual
 * spans to the stored_spans table via an event handler.
 *
 * @example
 * ```typescript
 * // Record a span (triggers both trace summary computation and span storage)
 * await traceProcessingPipeline.commands.recordSpan.send({
 *   tenantId: "tenant_123",
 *   spanData: { ... },
 *   collectedAtUnixMs: Date.now(),
 * });
 *
 * // Get trace summary
 * const summary = await traceProcessingPipeline.service.getProjectionByName(
 *   "traceSummary",
 *   traceId,
 *   { tenantId },
 * );
 * ```
 */
export const traceProcessingPipeline = eventSourcing
  .registerPipeline<TraceProcessingEvent>()
  .withName("trace_processing")
  .withAggregateType("trace")
  .withProjection("traceSummary", TraceSummaryProjectionHandler, {
    // This reduces projection rebuilds when many spans arrive rapidly for the same trace
    disableOrderingGuaranteeAndDebounceMs: 1000,
  })
  .withEventHandler("spanStorage", SpanStorageEventHandler, {
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
  })
  .withCommand("recordSpan", RecordSpanCommand)
  .build();
