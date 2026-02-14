import { definePipeline } from "../../library";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { spanStorageMapProjection } from "./handlers/spanStorage.mapProjection";
import { traceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "./schemas/events";

/**
 * Trace processing pipeline definition (static, no runtime dependencies).
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics (fold projection) and writes
 * individual spans to the stored_spans table (map projection).
 *
 * This is a static definition that can be safely imported without triggering
 * ClickHouse/Redis connections.
 */
export const traceProcessingPipelineDefinition =
  definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withFoldProjection("traceSummary", traceSummaryFoldProjection)
    .withMapProjection("spanStorage", spanStorageMapProjection)
    .withCommand("recordSpan", RecordSpanCommand)
    .withCommand("assignTopic", AssignTopicCommand)
    .build();
