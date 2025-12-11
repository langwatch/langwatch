import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { TraceSummaryProjectionHandler } from "./projections";
import type { TraceSummary } from "./projections/traceSummaryProjection";
import type { TraceProcessingEvent } from "./schemas/events";

/**
 * Trace processing pipeline for computing trace summaries.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics.
 *
 * Note: Individual span storage is handled by the separate span-storage pipeline.
 *
 * @example
 * ```typescript
 * // Record a span for trace summary computation
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
  .registerPipeline<TraceProcessingEvent, TraceSummary>()
  .withName("trace_processing")
  .withAggregateType("trace")
  .withProjection("traceSummary", TraceSummaryProjectionHandler)
  .withCommand("recordSpan", RecordSpanCommand)
  .build();
