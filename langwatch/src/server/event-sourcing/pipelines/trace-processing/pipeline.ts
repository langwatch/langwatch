import { eventSourcing } from "../../runtime";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import {
  SpanStorageProjectionHandler,
  TraceSummaryProjectionHandler,
} from "./projections";
import type { TraceSummary } from "./projections/traceSummaryProjection";
import type { TraceProcessingEvent } from "./schemas/events";

/**
 * Trace processing pipeline for handling span ingestion and trace aggregation.
 *
 * This pipeline:
 * 1. Receives spans via RecordSpanCommand
 * 2. Emits SpanReceivedEvent with full span data
 * 3. SpanStorageProjection writes spans to ClickHouse idempotently
 * 4. TraceSummaryProjection computes trace metrics from span events
 *
 * @example
 * ```typescript
 * // Record a span
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
  .withProjection("spanStorage", SpanStorageProjectionHandler)
  .withProjection("traceSummary", TraceSummaryProjectionHandler)
  .withCommand("recordSpan", RecordSpanCommand)
  .build();
