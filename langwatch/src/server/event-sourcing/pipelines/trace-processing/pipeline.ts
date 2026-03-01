import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { AssignSatisfactionScoreCommand } from "./commands/assignSatisfactionScoreCommand";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { createSpanStorageMapProjection } from "./projections/spanStorage.mapProjection";
import { createTraceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedSpan } from "./schemas/spans";

export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationTriggerReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  traceUpdateBroadcastReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  satisfactionScoreReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  spanStorageBroadcastReactor: ReactorDefinition<TraceProcessingEvent>;
}

/**
 * Creates the trace processing pipeline definition.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics (fold projection) and writes
 * individual spans to the stored_spans table (map projection).
 */
export function createTraceProcessingPipeline(deps: TraceProcessingPipelineDeps) {
  return definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withFoldProjection("traceSummary", createTraceSummaryFoldProjection({
      store: deps.traceSummaryStore,
    }))
    .withMapProjection("spanStorage", createSpanStorageMapProjection({
      store: deps.spanAppendStore,
    }))
    .withReactor("traceSummary", "evaluationTrigger", deps.evaluationTriggerReactor)
    .withReactor("traceSummary", "traceUpdateBroadcast", deps.traceUpdateBroadcastReactor)
    .withReactor("traceSummary", "satisfactionScore", deps.satisfactionScoreReactor)
    .withReactor("spanStorage", "spanStorageBroadcast", deps.spanStorageBroadcastReactor)
    .withCommand("recordSpan", RecordSpanCommand)
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("assignSatisfactionScore", AssignSatisfactionScoreCommand)
    .build();
}
