import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS } from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { TriggerContext } from "../../pipeline/processManagerDefinition";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "./projections/codingAgentSession.foldProjection";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
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
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "./schemas/constants";
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
  codingAgentSessionStore: FoldProjectionStore<CodingAgentSessionState>;
  originGateReactor: ReactorDefinition<TraceProcessingEvent, TraceSummaryData>;
  evaluationTriggerReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  customEvaluationSyncReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  traceUpdateBroadcastReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  projectMetadataReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  simulationMetricsSyncReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  experimentMetricsSyncReactor: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  automations: {
    triggerMatchHandler: (
      event: TraceProcessingEvent,
      context: TriggerContext<TraceSummaryData>,
    ) => Promise<void>;
    graphActivityHandler: (
      event: TraceProcessingEvent,
      context: { tenantId: string },
    ) => Promise<void>;
  };
  spanStorageBroadcastReactor: ReactorDefinition<TraceProcessingEvent>;
  customerIoTraceSyncReactor?: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  gatewayBudgetSyncReactor?: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
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
  governanceKpisSyncReactor?: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  retentionOrphanSweepReactor?: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
  governanceOcsfEventsSyncReactor?: ReactorDefinition<
    TraceProcessingEvent,
    TraceSummaryData
  >;
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
    // ADR-041. Folds spans, logs AND metrics into one row per coding-agent
    // session. Every trace flows through it, but only a coding agent's writes a
    // row — the store gates on the fold having actually seen a model call or a
    // tool run, so an ordinary LLM trace costs a name comparison and nothing more.
    .withFoldProjection(
      "codingAgentSession",
      new CodingAgentSessionFoldProjection({
        store: deps.codingAgentSessionStore,
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
    .withReactor("traceSummary", "originGate", deps.originGateReactor)
    .withReactor(
      "traceSummary",
      "evaluationTrigger",
      deps.evaluationTriggerReactor,
    )
    .withReactor(
      "traceSummary",
      "customEvaluationSync",
      deps.customEvaluationSyncReactor,
    )
    .withReactor(
      "traceSummary",
      "traceUpdateBroadcast",
      deps.traceUpdateBroadcastReactor,
    )
    .withReactor("traceSummary", "projectMetadata", deps.projectMetadataReactor)
    .withReactor(
      "traceSummary",
      "simulationMetricsSync",
      deps.simulationMetricsSyncReactor,
    )
    .withReactor(
      "traceSummary",
      "experimentMetricsSync",
      deps.experimentMetricsSyncReactor,
    )
    .withSubscriber("triggerMatch", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: 30_000,
      ttl: 30_000,
      handler: (event, context) =>
        deps.automations.triggerMatchHandler(event, context),
    })
    .withSubscriber("graphTriggerActivity", {
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
      dedup: {
        makeId: (event) => `graph-trigger-activity:${event.tenantId}`,
        ttlMs: GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
        extend: false,
        replace: false,
      },
      handler: (event, context) =>
        deps.automations.graphActivityHandler(event, context),
    })
    .withReactor(
      "spanStorage",
      "spanStorageBroadcast",
      deps.spanStorageBroadcastReactor,
    );

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
