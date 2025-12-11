import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import {
  DailyTraceCountProjectionHandler,
  TraceSummaryProjectionHandler,
} from "./projections";
import type { DailyTraceCount } from "./projections/dailyTraceCountProjection";
import type { TraceSummary } from "./projections/traceSummaryProjection";
import type { TraceProcessingEvent } from "./schemas/events";

/**
 * Trace processing pipeline for computing trace summaries and usage statistics.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics and daily trace counts.
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
  .registerPipeline<TraceProcessingEvent, TraceSummary | DailyTraceCount>()
  .withName("trace_processing")
  .withAggregateType("trace")
  .withProjection("traceSummary", TraceSummaryProjectionHandler)
  .withProjection("dailyTraceCount", DailyTraceCountProjectionHandler)
  .withCommand("recordSpan", RecordSpanCommand)
  .build();
