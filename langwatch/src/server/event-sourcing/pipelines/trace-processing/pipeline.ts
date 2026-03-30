import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { RecordLogCommand } from "./commands/recordLogCommand";
import { RecordMetricCommand } from "./commands/recordMetricCommand";
import { RecordSpanCommand } from "./commands/recordSpanCommand";
import { ResolveOriginCommand } from "./commands/resolveOriginCommand";
import { LogRecordStorageMapProjection } from "./projections/logRecordStorage.mapProjection";
import { MetricRecordStorageMapProjection } from "./projections/metricRecordStorage.mapProjection";
import { SpanStorageMapProjection } from "./projections/spanStorage.mapProjection";
import { TraceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
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
  projectMetadataReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  simulationMetricsSyncReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  spanStorageBroadcastReactor: ReactorDefinition<TraceProcessingEvent>;
  customerIoTraceSyncReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
}

/**
 * Creates the trace processing pipeline definition.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics (fold projection) and writes
 * individual spans to the stored_spans table (map projection).
 */
export function createTraceProcessingPipeline(deps: TraceProcessingPipelineDeps) {
  let builder = definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withFoldProjection("traceSummary", new TraceSummaryFoldProjection({
      store: deps.traceSummaryStore,
    }))
    .withMapProjection("spanStorage", new SpanStorageMapProjection({
      store: deps.spanAppendStore,
    }))
    .withMapProjection("logRecordStorage", new LogRecordStorageMapProjection({
      store: deps.logRecordAppendStore,
    }))
    .withMapProjection("metricRecordStorage", new MetricRecordStorageMapProjection({
      store: deps.metricRecordAppendStore,
    }))
    .withReactor("traceSummary", "evaluationTrigger", deps.evaluationTriggerReactor)
    .withReactor("traceSummary", "customEvaluationSync", deps.customEvaluationSyncReactor)
    .withReactor("traceSummary", "traceUpdateBroadcast", deps.traceUpdateBroadcastReactor)
    .withReactor("traceSummary", "projectMetadata", deps.projectMetadataReactor)
    .withReactor("traceSummary", "simulationMetricsSync", deps.simulationMetricsSyncReactor)
    .withReactor("spanStorage", "spanStorageBroadcast", deps.spanStorageBroadcastReactor);

  if (deps.customerIoTraceSyncReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "customerIoTraceSync",
      deps.customerIoTraceSyncReactor,
    );
  }

  return builder
    .withCommand("recordSpan", RecordSpanCommand)
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLog", RecordLogCommand)
    .withCommand("recordMetric", RecordMetricCommand)
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .build();
}
