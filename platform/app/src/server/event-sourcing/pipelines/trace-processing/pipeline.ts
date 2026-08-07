import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  graphTriggerActivityGroupKey,
} from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { definePipeline } from "../../";
import type { TriggerContext } from "../../pipeline/processManagerDefinition";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import {
  AddAnnotationCommand,
  BulkSyncAnnotationsCommand,
  RemoveAnnotationCommand,
} from "./commands/annotationCommands";
import { AssignTopicCommand } from "./commands/assignTopicCommand";
import { ChangeTraceNameCommand } from "./commands/changeTraceNameCommand";
import { RecordLogContributionCommand } from "./commands/recordLogContributionCommand";
import { RecordMetricCorrelationCommand } from "./commands/recordMetricCorrelationCommand";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "./commands/recordSpanCommand";
import { ResolveOriginCommand } from "./commands/resolveOriginCommand";
import {
  clampSpanShardCount,
  spanCommandGroupKey,
} from "./commands/spanCommandGroupKey";
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
import type { RecordSpanCommandData } from "./schemas/commands";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  RECORD_SPAN_COALESCE_MAX_BATCH,
  SPAN_RECEIVED_EVENT_TYPE,
} from "./schemas/constants";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedSpan } from "./schemas/spans";
import { TraceRequestUtils } from "./utils/traceRequest.utils";

export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: AppendStore<TraceAnalyticsRollupRow>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
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
  /** Cross-pipeline dispatchers (e.g. coding-agent span-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<TraceProcessingEvent>[];
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
      // One lane per tenant: the dedup bounds staging rate, the lane bounds
      // CONCURRENCY — without it, sweeps staged across successive windows sat
      // in per-trace groups and ran as a parallel storm (see
      // graphTriggerActivityGroupKey).
      groupKeyFn: graphTriggerActivityGroupKey,
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

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
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
  // ADR-066 pillar 2: a trace's spans all land in one group (or one of its
  // shards), so a busy trace appends one tiny insert per span. Coalesce the
  // group's queued spans into one multi-row insert instead.
  //
  // The bound is a resolver, not a constant, because of the ADR-022 spool. An
  // over-threshold span is queued as a spoolRef with its attributes cleared, so
  // its QUEUED size — the only size the drain's byte budget can weigh — is a few
  // hundred bytes, while the span the handler reconstitutes from object storage
  // is over 256 KB and has no upper bound. Folding those by count would let the
  // byte budget wave through a batch whose true size it never saw. A spooled
  // span therefore caps itself at 1 and is appended on its own, exactly as the
  // oversized-item case is meant to behave; inline spans are bounded by
  // COMMAND_INLINE_THRESHOLD, so for them the byte budget is honest and does the
  // real work. The handler derives its event from its own command alone and
  // never reads back a same-batch append, and its post-store spool cleanup runs
  // per command, so both are safe to fold.
  const recordSpanOptions: {
    deduplication: typeof RECORD_SPAN_DEDUPLICATION;
    getGroupKey?: (payload: RecordSpanCommandData) => string;
    coalesceMaxBatch: (payload: RecordSpanCommandData) => number;
  } = {
    deduplication: RECORD_SPAN_DEDUPLICATION,
    coalesceMaxBatch: (payload) =>
      payload.spoolRef ? 1 : RECORD_SPAN_COALESCE_MAX_BATCH,
  };
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

  // ADR-022: When blobStore is provided, inject it into a pre-constructed
  // RecordSpanCommand instance so the worker can reconstitute oversized commands
  // (S3 spool fetch + best-effort delete). Falls back to zero-arg construction
  // (no spool support) when blobStore is absent. Either way the recordSpan
  // command carries the dedup config and span-command sharding from main.
  const recordSpanBuilder = deps.blobStore
    ? builder.withCommandInstance({
        name: "recordSpan",
        handlerClass: RecordSpanCommand,
        instance: new RecordSpanCommand({ blobStore: deps.blobStore }),
        options: recordSpanOptions,
      })
    : builder.withCommand("recordSpan", RecordSpanCommand, recordSpanOptions);

  return recordSpanBuilder
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLogContribution", RecordLogContributionCommand)
    .withCommand("recordMetricCorrelation", RecordMetricCorrelationCommand)
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .withCommand("addAnnotation", AddAnnotationCommand)
    .withCommand("removeAnnotation", RemoveAnnotationCommand)
    .withCommand("bulkSyncAnnotations", BulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", ChangeTraceNameCommand)
    .build();
}
