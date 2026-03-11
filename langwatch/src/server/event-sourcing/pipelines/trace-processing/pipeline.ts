import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { AssignSatisfactionScoreCommand } from "./commands/assignSatisfactionScoreCommand";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { RecordLogCommand } from "./commands/recordLogCommand";
import { RecordMetricCommand } from "./commands/recordMetricCommand";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { createLogRecordStorageMapProjection } from "./projections/logRecordStorage.mapProjection";
import { createMetricRecordStorageMapProjection } from "./projections/metricRecordStorage.mapProjection";
import { createSpanStorageMapProjection } from "./projections/spanStorage.mapProjection";
import { createTraceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedLogRecord } from "./schemas/logRecords";
import type { NormalizedMetricRecord } from "./schemas/metricRecords";
import type { NormalizedSpan } from "./schemas/spans";

export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  logRecordAppendStore: AppendStore<NormalizedLogRecord>;
  metricRecordAppendStore: AppendStore<NormalizedMetricRecord>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  evaluationTriggerReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  customEvaluationSyncReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  traceUpdateBroadcastReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
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
    .withMapProjection("logRecordStorage", createLogRecordStorageMapProjection({
      store: deps.logRecordAppendStore,
    }))
    .withMapProjection("metricRecordStorage", createMetricRecordStorageMapProjection({
      store: deps.metricRecordAppendStore,
    }))
    .withReactor("traceSummary", "evaluationTrigger", deps.evaluationTriggerReactor)
    .withReactor("traceSummary", "customEvaluationSync", deps.customEvaluationSyncReactor)
    .withReactor("traceSummary", "traceUpdateBroadcast", deps.traceUpdateBroadcastReactor)
    .withReactor("spanStorage", "spanStorageBroadcast", deps.spanStorageBroadcastReactor)
    .withCommand("recordSpan", RecordSpanCommand)
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("assignSatisfactionScore", AssignSatisfactionScoreCommand)
    .withCommand("recordLog", RecordLogCommand)
    .withCommand("recordMetric", RecordMetricCommand)
    .build();
}
