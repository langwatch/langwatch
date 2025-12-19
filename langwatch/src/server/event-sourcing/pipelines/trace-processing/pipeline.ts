import { definePipeline } from "../../library";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import {
  SpanStorageEventHandler,
  TraceDailyUsageEventHandler,
} from "./handlers";
import { TraceSummaryProjectionHandler } from "./projections";
import type { TraceProcessingEvent } from "./schemas/events";
import { SPAN_RECEIVED_EVENT_TYPE } from "./schemas/constants";
import { env } from "~/env.mjs";
import { featureFlagService } from "~/server/featureFlag";

/**
 * Trace processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics and writes individual
 * spans to the stored_spans table via an event handler.
 *
 * This is a static definition that can be safely imported without triggering
 * ClickHouse/Redis connections. It gets registered with the runtime in
 * the pipeline's index.ts file.
 */
export const traceProcessingPipelineDefinition =
  definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withProjection("traceSummary", TraceSummaryProjectionHandler, {
      // This reduces strain of computationally heavy trace summary projections being done
      // unnecessarily due to the burst-heavy nature of span collection.
      debounceMs: 1500,
    })
    .withEventHandler("spanStorage", SpanStorageEventHandler, {
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    })
    .withEventHandler("traceDailyUsage", TraceDailyUsageEventHandler, {
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
      delay: 5000,
      disabled: !env.IS_SAAS && false,
    })
    .withCommand("recordSpan", RecordSpanCommand)
    .build();
