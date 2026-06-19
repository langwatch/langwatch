import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { definePipeline } from "../../";
import type { OutboxReactorDefinition } from "../../outbox/outboxReactor.types";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { AddAnnotationCommand, BulkSyncAnnotationsCommand, RemoveAnnotationCommand } from "./commands/annotationCommands";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { ChangeTraceNameCommand } from "./commands/changeTraceNameCommand";
import { RecordLogCommand } from "./commands/recordLogCommand";
import { RecordMetricCommand } from "./commands/recordMetricCommand";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "./commands/recordSpanCommand";
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
  originGateReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  evaluationTriggerReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  customEvaluationSyncReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  traceUpdateBroadcastReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  projectMetadataReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  simulationMetricsSyncReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  experimentMetricsSyncReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  /** PERSIST-class branch of the alert trigger, routed through the
   *  framework's `.withOutbox` plumbing (ADR-030 + ADR-032). Emits settle
   *  payloads stamped `actionClass: "persist"`; the dispatcher's cadence
   *  stage runs `dispatchTriggerAction` for them. */
  alertTriggerReactor: OutboxReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  /** NOTIFY-class branch of the alert trigger, routed through the
   *  framework's `.withOutbox` plumbing (ADR-030). Always provided;
   *  the framework adapter no-ops on process roles without an outbox
   *  runtime, so unconditional registration is safe. */
  alertTriggerNotifyOutboxReactor: OutboxReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  spanStorageBroadcastReactor: ReactorDefinition<TraceProcessingEvent>;
  claudeCodeSpanSyncReactor: ReactorDefinition<TraceProcessingEvent>;
  customerIoTraceSyncReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  gatewayBudgetSyncReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  /**
   * ADR-022: BlobStore injected so RecordSpanCommand can reconstitute oversized
   * commands (fetch from S3 spool) and best-effort delete the spool after
   * event_log INSERT succeeds. Optional — without it, the spool path is disabled.
   */
  blobStore?: BlobStore;
  governanceKpisSyncReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  retentionOrphanSweepReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  governanceOcsfEventsSyncReactor?: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
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
    .withReactor("traceSummary", "originGate", deps.originGateReactor)
    .withReactor("traceSummary", "evaluationTrigger", deps.evaluationTriggerReactor)
    .withReactor("traceSummary", "customEvaluationSync", deps.customEvaluationSyncReactor)
    .withReactor("traceSummary", "traceUpdateBroadcast", deps.traceUpdateBroadcastReactor)
    .withReactor("traceSummary", "projectMetadata", deps.projectMetadataReactor)
    .withReactor("traceSummary", "simulationMetricsSync", deps.simulationMetricsSyncReactor)
    .withReactor("traceSummary", "experimentMetricsSync", deps.experimentMetricsSyncReactor)
    .withOutbox("traceSummary", "alertTrigger", deps.alertTriggerReactor)
    .withOutbox(
      "traceSummary",
      "alertTriggerNotifyOutbox",
      deps.alertTriggerNotifyOutboxReactor,
    )
    .withReactor("spanStorage", "spanStorageBroadcast", deps.spanStorageBroadcastReactor)
    .withReactor("logRecordStorage", "claudeCodeSpanSync", deps.claudeCodeSpanSyncReactor);

  if (deps.customerIoTraceSyncReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "customerIoTraceSync",
      deps.customerIoTraceSyncReactor,
    );
  }

  if (deps.gatewayBudgetSyncReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "gatewayBudgetSync",
      deps.gatewayBudgetSyncReactor,
    );
  }

  if (deps.governanceKpisSyncReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "governanceKpisSync",
      deps.governanceKpisSyncReactor,
    );
  }

  if (deps.governanceOcsfEventsSyncReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "governanceOcsfEventsSync",
      deps.governanceOcsfEventsSyncReactor,
    );
  }

  if (deps.retentionOrphanSweepReactor) {
    builder = builder.withReactor(
      "traceSummary",
      "retentionOrphanSweep",
      deps.retentionOrphanSweepReactor,
    );
  }

  // ADR-022: When blobStore is provided, inject it into a pre-constructed
  // RecordSpanCommand instance so the worker can reconstitute oversized commands
  // (S3 spool fetch + best-effort delete). Falls back to zero-arg construction
  // (no spool support) when blobStore is absent. Either way the recordSpan
  // command carries the dedup config from main.
  const recordSpanBuilder = deps.blobStore
    ? builder.withCommandInstance(
        "recordSpan",
        RecordSpanCommand,
        new RecordSpanCommand({ blobStore: deps.blobStore }),
        { deduplication: RECORD_SPAN_DEDUPLICATION },
      )
    : builder.withCommand("recordSpan", RecordSpanCommand, {
        deduplication: RECORD_SPAN_DEDUPLICATION,
      });

  return recordSpanBuilder
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLog", RecordLogCommand)
    .withCommand("recordMetric", RecordMetricCommand)
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .withCommand("addAnnotation", AddAnnotationCommand)
    .withCommand("removeAnnotation", RemoveAnnotationCommand)
    .withCommand("bulkSyncAnnotations", BulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", ChangeTraceNameCommand)
    .build();
}
