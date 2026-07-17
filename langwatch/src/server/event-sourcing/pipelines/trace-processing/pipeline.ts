import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  GRAPH_ALERT_SWEEP_PROCESS_NAME,
  graphAlertSweepPM,
  type GraphAlertSweepDeps,
} from "~/server/app-layer/triggers/process-manager/graphAlertSweep.process";
import {
  TRIGGER_SETTLEMENT_PROCESS_NAME,
  triggerSettlementPM,
  type TriggerSettlementPmDeps,
} from "~/server/app-layer/triggers/process-manager/triggerSettlement.process";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/app-layer/triggers/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { SubscriberSpec } from "../../pipeline/processManagerDefinition";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { TraceSummarySubscriber } from "./reactors/_originGuardedSubscriber";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "./schemas/constants";
import {
  AddAnnotationCommand,
  BulkSyncAnnotationsCommand,
  RemoveAnnotationCommand,
} from "./commands/annotationCommands";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { ChangeTraceNameCommand } from "./commands/changeTraceNameCommand";
import {
  clampLogShardCount,
  logCommandGroupKey,
} from "./commands/logCommandGroupKey";
import { RecordLogCommand } from "./commands/recordLogCommand";
import { RecordMetricCommand } from "./commands/recordMetricCommand";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "./commands/recordSpanCommand";
import { ResolveOriginCommand } from "./commands/resolveOriginCommand";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "./commands/spanCommandGroupKey";
import { LogRecordStorageMapProjection } from "./projections/logRecordStorage.mapProjection";
import { MetricRecordStorageMapProjection } from "./projections/metricRecordStorage.mapProjection";
import { SpanStorageMapProjection } from "./projections/spanStorage.mapProjection";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "./projections/traceAnalytics.foldProjection";
import {
  TraceAnalyticsRollupMapProjection,
  type TraceAnalyticsRollupRow,
} from "./projections/traceAnalyticsRollup.mapProjection";
import { TraceSummaryFoldProjection } from "./projections/traceSummary.foldProjection";
import type {
  RecordLogCommandData,
  RecordSpanCommandData,
} from "./schemas/commands";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedLogRecord } from "./schemas/logRecords";
import type { NormalizedMetricRecord } from "./schemas/metricRecords";
import type { NormalizedSpan } from "./schemas/spans";
import { TraceRequestUtils } from "./utils/traceRequest.utils";

export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: AppendStore<TraceAnalyticsRollupRow>;
  logRecordAppendStore: AppendStore<NormalizedLogRecord>;
  metricRecordAppendStore: AppendStore<NormalizedMetricRecord>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
  originGateReactor: TraceSummarySubscriber;
  evaluationTriggerReactor: TraceSummarySubscriber;
  customEvaluationSyncReactor: TraceSummarySubscriber;
  traceUpdateBroadcastReactor: TraceSummarySubscriber;
  projectMetadataReactor: TraceSummarySubscriber;
  simulationMetricsSyncReactor: TraceSummarySubscriber;
  experimentMetricsSyncReactor: TraceSummarySubscriber;
  /**
   * ADR-052: the automation reactions. The triggerSettlement process
   * manager (settle debounce + cadence digest) is MOUNTED here with its
   * trace-side match feed on post-fold traceSummary semantics; the
   * graphAlertSweep scheduled singleton owns the 30s absence/resolve
   * sweep; the activity subscriber is the stateless real-time graph
   * evaluation path.
   */
  automations?: {
    settlement: TriggerSettlementPmDeps;
    sweep: GraphAlertSweepDeps;
    graphActivityHandler: (
      event: TraceProcessingEvent,
      context: { tenantId: string },
    ) => Promise<void>;
  };
  spanStorageBroadcastReactor: {
    name: string;
    spec: SubscriberSpec<TraceProcessingEvent>;
  };
  claudeCodeSpanSyncReactor: {
    name: string;
    spec: SubscriberSpec<TraceProcessingEvent>;
  };
  customerIoTraceSyncReactor?: TraceSummarySubscriber;
  gatewayBudgetSyncReactor?: TraceSummarySubscriber;
  /**
   * ADR-022: BlobStore injected so RecordSpanCommand can reconstitute oversized
   * commands (fetch from S3 spool) and best-effort delete the spool after
   * event_log INSERT succeeds. Optional — without it, the spool path is disabled.
   */
  blobStore?: BlobStore;
  /**
   * Number of GroupQueue shards for `recordSpan` commands. `1` (default) keeps
   * the historic per-trace group key; `> 1` spreads a trace's spans across
   * `traceId:<shard>` groups so a hot trace drains in parallel. The trace-summary
   * fold is unaffected — it runs on its own aggregate-keyed queue. See
   * spanCommandGroupKey.ts.
   */
  spanCommandShardCount?: number;
  /**
   * Number of GroupQueue shards for `recordLog` commands. `1` (default) keeps
   * the historic per-trace group key; `> 1` spreads one Claude Code turn's log
   * records across `traceId:<shard>` groups so a turn that streams thousands of
   * log records drains in parallel instead of FIFO'ing behind one worker. The
   * trace-summary fold and the claude-span-sync reactor are unaffected - both
   * run on their own aggregate-keyed queue. See logCommandGroupKey.ts.
   */
  logCommandShardCount?: number;
  governanceKpisSyncReactor?: TraceSummarySubscriber;
  retentionOrphanSweepReactor?: TraceSummarySubscriber;
  governanceOcsfEventsSyncReactor?: TraceSummarySubscriber;
}

/**
 * Creates the trace processing pipeline definition.
 *
 * This pipeline uses trace-level aggregates (aggregateId = traceId).
 * It aggregates span events into trace summary metrics (fold projection) and writes
 * individual spans to the stored_spans table (map projection).
 */
export function createTraceProcessingPipeline(
  deps: TraceProcessingPipelineDeps,
) {
  let builder = definePipeline<TraceProcessingEvent>()
    .withName("trace_processing")
    .withAggregateType("trace")
    .withFoldProjection(
      "traceSummary",
      new TraceSummaryFoldProjection({
        store: deps.traceSummaryStore,
      }),
    )
    .withFoldProjection(
      "traceAnalytics",
      new TraceAnalyticsFoldProjection({
        store: deps.traceAnalyticsStore,
      }),
    )
    .withMapProjection(
      "spanStorage",
      new SpanStorageMapProjection({
        store: deps.spanAppendStore,
      }),
    )
    .withMapProjection(
      "traceAnalyticsRollup",
      new TraceAnalyticsRollupMapProjection({
        store: deps.traceAnalyticsRollupAppendStore,
      }),
    )
    .withMapProjection(
      "logRecordStorage",
      new LogRecordStorageMapProjection({
        store: deps.logRecordAppendStore,
      }),
    )
    .withMapProjection(
      "metricRecordStorage",
      new MetricRecordStorageMapProjection({
        store: deps.metricRecordAppendStore,
      }),
    )
    .withSubscriber(deps.originGateReactor.name, deps.originGateReactor.spec)
    .withSubscriber(
      deps.evaluationTriggerReactor.name,
      deps.evaluationTriggerReactor.spec,
    )
    .withSubscriber(
      deps.customEvaluationSyncReactor.name,
      deps.customEvaluationSyncReactor.spec,
    )
    .withSubscriber(
      deps.traceUpdateBroadcastReactor.name,
      deps.traceUpdateBroadcastReactor.spec,
    )
    .withSubscriber(
      deps.projectMetadataReactor.name,
      deps.projectMetadataReactor.spec,
    )
    .withSubscriber(
      deps.simulationMetricsSyncReactor.name,
      deps.simulationMetricsSyncReactor.spec,
    )
    .withSubscriber(
      deps.experimentMetricsSyncReactor.name,
      deps.experimentMetricsSyncReactor.spec,
    )
    .withSubscriber(
      deps.spanStorageBroadcastReactor.name,
      deps.spanStorageBroadcastReactor.spec,
    )
    .withSubscriber(
      deps.claudeCodeSpanSyncReactor.name,
      deps.claudeCodeSpanSyncReactor.spec,
    );

  if (deps.customerIoTraceSyncReactor) {
    builder = builder.withSubscriber(
      deps.customerIoTraceSyncReactor.name,
      deps.customerIoTraceSyncReactor.spec,
    );
  }

  if (deps.gatewayBudgetSyncReactor) {
    builder = builder.withSubscriber(
      deps.gatewayBudgetSyncReactor.name,
      deps.gatewayBudgetSyncReactor.spec,
    );
  }

  if (deps.governanceKpisSyncReactor) {
    builder = builder.withSubscriber(
      deps.governanceKpisSyncReactor.name,
      deps.governanceKpisSyncReactor.spec,
    );
  }

  if (deps.governanceOcsfEventsSyncReactor) {
    builder = builder.withSubscriber(
      deps.governanceOcsfEventsSyncReactor.name,
      deps.governanceOcsfEventsSyncReactor.spec,
    );
  }

  if (deps.retentionOrphanSweepReactor) {
    builder = builder.withSubscriber(
      deps.retentionOrphanSweepReactor.name,
      deps.retentionOrphanSweepReactor.spec,
    );
  }

  // ADR-052: the automation reactions.
  if (deps.automations) {
    const automations = deps.automations;
    builder = builder
      .withProcessManager(
        TRIGGER_SETTLEMENT_PROCESS_NAME,
        triggerSettlementPM(automations.settlement),
      )
      .withProcessManager(
        GRAPH_ALERT_SWEEP_PROCESS_NAME,
        graphAlertSweepPM(automations.sweep),
      )
      .withSubscriber("graphTriggerActivity", {
        events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
        delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        dedup: {
          makeId: (event) => `graph-trigger-activity:${event.tenantId}`,
          ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
          // Collapse-within-window, do NOT debounce-extend: constant
          // traffic must still evaluate every window.
          extend: false,
          replace: false,
        },
        handler: (event, context) =>
          automations.graphActivityHandler(event, context),
      });
  }

  // Span-command sharding: when the shard count is > 1, install a getGroupKey
  // that spreads a trace's recordSpan commands across `traceId:<shard>`
  // GroupQueue groups so a hot trace drains in parallel instead of one span at a
  // time. When disabled (the default), install NO getGroupKey — the command
  // falls back to getAggregateId, byte-identical to the historic per-trace key
  // and with zero extra work on the span-ingest hot path. The count is clamped
  // defensively so a caller constructing the pipeline directly (bypassing
  // PipelineRegistry's env resolver) can't explode the number of groups. The
  // command handler reads no trace state and the emitted span_received event
  // still carries aggregateId = traceId, so the trace-summary fold (its own
  // aggregate-keyed queue) is unaffected and the summary stays exact. See
  // spanCommandGroupKey.ts and specs/event-sourcing/span-command-sharding.feature.
  const spanCommandShardCount = clampSpanShardCount(
    deps.spanCommandShardCount ?? 1,
  );
  const recordSpanOptions: {
    deduplication: typeof RECORD_SPAN_DEDUPLICATION;
    getGroupKey?: (payload: RecordSpanCommandData) => string;
  } = { deduplication: RECORD_SPAN_DEDUPLICATION };
  if (spanCommandShardCount > 1) {
    recordSpanOptions.getGroupKey = (payload) => {
      const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
        payload.span,
      );
      return spanCommandGroupKey({
        traceId,
        spanId,
        shardCount: spanCommandShardCount,
      });
    };
  }

  // Log-command sharding: when the shard count is > 1, install a getGroupKey
  // that spreads a trace's recordLog commands across `traceId:<shard>`
  // GroupQueue groups so one Claude Code turn that streams thousands of log
  // records drains in parallel instead of FIFO'ing behind one worker. When
  // disabled (the default), install NO getGroupKey - the command falls back to
  // getAggregateId, byte-identical to the historic per-trace key. The count is
  // clamped defensively so a caller constructing the pipeline directly can't
  // explode the number of groups. The command handler reads no trace state and
  // the emitted log_record_received event still carries aggregateId = traceId,
  // so the trace-summary fold and the claude-span-sync reactor (each on its own
  // aggregate-keyed queue) are unaffected and the turn's tool-output join stays
  // intact. See logCommandGroupKey.ts and
  // specs/claude/telemetry-turn-bounding.feature.
  const logCommandShardCount = clampLogShardCount(
    deps.logCommandShardCount ?? 1,
  );
  const recordLogOptions: {
    getGroupKey?: (payload: RecordLogCommandData) => string;
  } = {};
  if (logCommandShardCount > 1) {
    recordLogOptions.getGroupKey = (payload) =>
      logCommandGroupKey({
        traceId: payload.traceId,
        spanId: payload.spanId,
        shardCount: logCommandShardCount,
      });
  }

  // ADR-022: When blobStore is provided, inject it into a pre-constructed
  // RecordSpanCommand instance so the worker can reconstitute oversized commands
  // (S3 spool fetch + best-effort delete). Falls back to zero-arg construction
  // (no spool support) when blobStore is absent. Either way the recordSpan
  // command carries the dedup config and span-command sharding from main.
  const recordSpanBuilder = deps.blobStore
    ? builder.withCommandInstance(
        "recordSpan",
        RecordSpanCommand,
        new RecordSpanCommand({ blobStore: deps.blobStore }),
        recordSpanOptions,
      )
    : builder.withCommand("recordSpan", RecordSpanCommand, recordSpanOptions);

  return recordSpanBuilder
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLog", RecordLogCommand, recordLogOptions)
    .withCommand("recordMetric", RecordMetricCommand)
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .withCommand("addAnnotation", AddAnnotationCommand)
    .withCommand("removeAnnotation", RemoveAnnotationCommand)
    .withCommand("bulkSyncAnnotations", BulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", ChangeTraceNameCommand)
    .build();
}
