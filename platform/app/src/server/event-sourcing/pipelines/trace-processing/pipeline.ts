import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
  type FoldProjectionStore,
  type SubscriberSpec,
  type TriggerContext,
  throttledWindow,
} from "@langwatch/eventing";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  graphTriggerActivityGroupKey,
} from "~/server/event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
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
  TRACE_CORRELATION_COALESCE_MAX_BATCH,
  TRACE_PROCESSING_EVENT_TYPES,
} from "./schemas/constants";
import type { TraceProcessingEvent } from "./schemas/events";
import type { NormalizedSpan } from "./schemas/spans";
import type { TraceSummarySubscriber } from "./subscribers/_originGuardedSubscriber";
import {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  customEvaluationSyncDedupId,
  hasSyncableEvaluations,
} from "./subscribers/customEvaluationSync.subscriber";
import {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  hasExperimentCostMetrics,
} from "./subscribers/experimentMetricsSync.subscriber";
import {
  needsOriginResolution,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
} from "./subscribers/originGate.subscriber";
import {
  isRealFirstIngest,
  PROJECT_METADATA_WINDOW_MS,
  projectMetadataGroupKey,
} from "./subscribers/projectMetadata.subscriber";
import {
  hasSimulationMetrics,
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
} from "./subscribers/simulationMetricsSync.subscriber";
import { SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS } from "./subscribers/spanStorageBroadcast.subscriber";
import { TRACE_UPDATE_BROADCAST_WINDOW_MS } from "./subscribers/traceUpdateBroadcast.subscriber";
import {
  hasSyncableFeedback,
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  trackedEventSyncDedupId,
} from "./subscribers/trackedEventSync.subscriber";
import { TraceRequestUtils } from "./utils/traceRequest.utils";

/** A subscriber handler on the committed traceSummary fold state. */
export type TraceSummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

export interface TraceProcessingPipelineDeps {
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: AppendStore<TraceAnalyticsRollupRow>;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
  originGateHandler: TraceSummaryHandler;
  evaluationTrigger: TraceSummarySubscriber;
  customEvaluationSyncHandler: TraceSummaryHandler;
  trackedEventSyncHandler: TraceSummaryHandler;
  traceUpdateBroadcastHandler: TraceSummaryHandler;
  projectMetadataHandler: TraceSummaryHandler;
  simulationMetricsSyncHandler: TraceSummaryHandler;
  experimentMetricsSyncHandler: TraceSummaryHandler;
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
  spanStorageBroadcastHandler: (
    event: TraceProcessingEvent,
    context: TriggerContext<unknown>,
  ) => Promise<void>;
  /**
   * True when the worker-to-web pub/sub bridge is unavailable (no Redis), so
   * the broadcast subscribers stay registered but inert.
   */
  broadcastDisabled?: boolean;
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
  /** EE governance rollups, composed as full subscriber specs in the
   *  registry so this OSS pipeline stays free of `@ee` imports. */
  governanceKpisSync?: SubscriberSpec<TraceProcessingEvent> & {
    fold: "traceSummary";
  };
  governanceOcsfEventsSync?: SubscriberSpec<TraceProcessingEvent> & {
    fold: "traceSummary";
  };
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
  let builder = definePipeline<TraceProcessingEvent>({
    name: "trace_processing",
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(TRACE_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      new TraceSummaryFoldProjection({
        store: deps.traceSummaryStore,
      }),
    )
    .withClickHouseFoldProjection(
      new TraceAnalyticsFoldProjection({
        store: deps.traceAnalyticsStore,
      }),
    )
    .withClickHouseMapProjection(
      new SpanStorageMapProjection({
        store: deps.spanAppendStore,
      }),
    )
    .withClickHouseMapProjection(
      new TraceAnalyticsRollupMapProjection({
        store: deps.traceAnalyticsRollupAppendStore,
      }),
    )
    // Deferred origin resolution for pure OTEL traces: reject pre-enqueue as
    // soon as the committed fold shows a resolved origin.
    .withProjectionSubscriber("originGate", {
      fold: "traceSummary",
      when: (event, context) =>
        needsOriginResolution({ event, foldState: context.state }),
      delay: ORIGIN_GATE_DELAY_MS,
      ttl: ORIGIN_GATE_DEDUP_TTL_MS,
      handler: (event, context) => deps.originGateHandler(event, context),
    })
    // Evaluation dispatch, origin-guarded (spec + guards composed by
    // createEvaluationTriggerSubscriber).
    .withProjectionSubscriber(
      deps.evaluationTrigger.name,
      deps.evaluationTrigger.spec,
    )
    // Custom SDK evaluations reported on spans. Stake-sensitive but idempotent
    // (deterministic evaluation IDs), and the queue's redelivery covers the
    // post-enqueue path; keeps the subscriber-era name so jobs staged before a
    // deploy dispatch into this registration after it.
    .withProjectionSubscriber("customEvaluationSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: hasSyncableEvaluations,
      delay: CUSTOM_EVAL_SYNC_DELAY_MS,
      ttl: CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
      dedupId: customEvaluationSyncDedupId,
      handler: (event, context) =>
        deps.customEvaluationSyncHandler(event, context),
    })
    // Live span feedback (langwatch.event) → tracked event, same path as the
    // REST track_event endpoint; deterministic ids keep retries idempotent.
    .withProjectionSubscriber("trackedEventSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: hasSyncableFeedback,
      delay: TRACKED_EVENT_SYNC_DELAY_MS,
      ttl: TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
      dedupId: trackedEventSyncDedupId,
      handler: (event, context) => deps.trackedEventSyncHandler(event, context),
    })
    // SSE notification, throttled to the listener's own debounce; lossy by
    // contract and disabled entirely without the Redis pub/sub bridge.
    .withProjectionSubscriber("traceUpdateBroadcast", {
      fold: "traceSummary",
      runIn: ["worker"],
      disabled: deps.broadcastDisabled,
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
        windowMs: TRACE_UPDATE_BROADCAST_WINDOW_MS,
      }),
      handler: (event, context) =>
        deps.traceUpdateBroadcastHandler(event, context),
    })
    // First-ingest project flags, one serialized lane and one dedup key per
    // project (see projectMetadataGroupKey for why the two must pair).
    .withProjectionSubscriber("projectMetadata", {
      fold: "traceSummary",
      runIn: ["worker"],
      when: (_event, context) => isRealFirstIngest(context.state),
      groupKeyFn: projectMetadataGroupKey,
      ...throttledWindow<TraceProcessingEvent>({
        makeId: (event) => event.tenantId,
        windowMs: PROJECT_METADATA_WINDOW_MS,
      }),
      handler: (event, context) => deps.projectMetadataHandler(event, context),
    })
    // Trace-side ECST publishers: fire once per trace after a quiet minute.
    .withProjectionSubscriber("simulationMetricsSync", {
      fold: "traceSummary",
      when: (_event, context) => hasSimulationMetrics(context.state),
      delay: SIMULATION_METRICS_SYNC_DELAY_MS,
      ttl: SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
      handler: (event, context) =>
        deps.simulationMetricsSyncHandler(event, context),
    })
    .withProjectionSubscriber("experimentMetricsSync", {
      fold: "traceSummary",
      when: (_event, context) => hasExperimentCostMetrics(context.state),
      delay: EXPERIMENT_METRICS_SYNC_DELAY_MS,
      ttl: EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
      handler: (event, context) =>
        deps.experimentMetricsSyncHandler(event, context),
    })
    .withProjectionSubscriber("triggerMatch", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: 30_000,
      ttl: 30_000,
      handler: (event, context) =>
        deps.automations.triggerMatchHandler(event, context),
    })
    .withEventSubscriber("graphTriggerActivity", {
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
    // SSE notification after span storage commits; the subscriber-scoped
    // dedup key keeps it independent of traceUpdateBroadcast's window.
    .withProjectionSubscriber("spanStorageBroadcast", {
      map: "spanStorage",
      runIn: ["worker"],
      disabled: deps.broadcastDisabled,
      ttl: SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
      handler: (event, context) =>
        deps.spanStorageBroadcastHandler(event, context),
    });

  if (deps.governanceKpisSync) {
    builder = builder.withProjectionSubscriber(
      "governanceKpisSync",
      deps.governanceKpisSync,
    );
  }

  if (deps.governanceOcsfEventsSync) {
    builder = builder.withProjectionSubscriber(
      "governanceOcsfEventsSync",
      deps.governanceOcsfEventsSync,
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
  // spanCommandGroupKey.ts and specs/trace-processing/span-command-sharding.feature.
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
    ? builder.withCommandInstance(
        "recordSpan",
        RecordSpanCommand,
        new RecordSpanCommand({ blobStore: deps.blobStore }),
        recordSpanOptions,
      )
    : builder.withCommand("recordSpan", RecordSpanCommand, recordSpanOptions);

  // ADR-066 pillar 2: both correlation commands funnel on the trace aggregate.
  // See TRACE_CORRELATION_COALESCE_MAX_BATCH.
  //
  // A literal per registration, not one shared object: `recordSpanOptions`
  // above is mutated after construction, so an options object here would invite
  // the same treatment and silently apply one command's change to the other.
  return recordSpanBuilder
    .withCommand("assignTopic", AssignTopicCommand)
    .withCommand("recordLogContribution", RecordLogContributionCommand, {
      coalesceMaxBatch: TRACE_CORRELATION_COALESCE_MAX_BATCH,
    })
    .withCommand("recordMetricCorrelation", RecordMetricCorrelationCommand, {
      coalesceMaxBatch: TRACE_CORRELATION_COALESCE_MAX_BATCH,
    })
    .withCommand("resolveOrigin", ResolveOriginCommand)
    .withCommand("addAnnotation", AddAnnotationCommand)
    .withCommand("removeAnnotation", RemoveAnnotationCommand)
    .withCommand("bulkSyncAnnotations", BulkSyncAnnotationsCommand)
    .withCommand("changeTraceName", ChangeTraceNameCommand)
    .build();
}
