import {
  type AppendStore,
  type EventSubscriberDefinition,
  type FoldProjectionStore,
  type SubscriberSpec,
  type TriggerContext,
  throttledWindow,
} from "@langwatch/eventing";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { AppTraceProjectionsAdapter } from "./trace-projections.adapter";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  graphTriggerActivityGroupKey,
} from "@langwatch/automation-server";
import {
  RecordSpanCommand,
  type EventingTracePipelineAdapterOptions,
} from "@langwatch/trace-server";
import { ORIGIN_RESOLVED_EVENT_TYPE, SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import type { TraceSummarySubscriber } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/_originGuardedSubscriber";
import {
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  customEvaluationSyncDedupId,
  hasSyncableEvaluations,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/customEvaluationSync.subscriber";
import {
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  hasExperimentCostMetrics,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/experimentMetricsSync.subscriber";
import {
  needsOriginResolution,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/originGate.subscriber";
import {
  isRealFirstIngest,
  PROJECT_METADATA_WINDOW_MS,
  projectMetadataGroupKey,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/projectMetadata.subscriber";
import {
  hasSimulationMetrics,
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/simulationMetricsSync.subscriber";
import { SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/spanStorageBroadcast.subscriber";
import { TRACE_UPDATE_BROADCAST_WINDOW_MS } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/traceUpdateBroadcast.subscriber";
import {
  hasSyncableFeedback,
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  trackedEventSyncDedupId,
} from "~/server/event-sourcing/pipelines/trace-processing/subscribers/trackedEventSync.subscriber";

/** A subscriber handler on the committed traceSummary fold state. */
export type TraceSummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

export interface TraceProcessingPipelineDeps {
  recordSpanCommand: RecordSpanCommand;
  traceCanonicalisation: TraceCanonicalisationService;
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer (app-side, replaces the MV). */
  traceAnalyticsRollupAppendStore: EventingTracePipelineAdapterOptions["rollupStore"];
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer (silent dual-tap, no read path). */
  traceAnalyticsStore: EventingTracePipelineAdapterOptions["derivedStore"];
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
export function createTraceProcessingPipeline(deps: TraceProcessingPipelineDeps) {
  let builder = AppTraceProjectionsAdapter.create({
    canonicalisation: deps.traceCanonicalisation,
    spanStore: deps.spanAppendStore,
    summaryStore: deps.traceSummaryStore,
    derivedStore: deps.traceAnalyticsStore,
    rollupStore: deps.traceAnalyticsRollupAppendStore,
    recordSpanCommand: deps.recordSpanCommand,
    spanCommandShardCount: deps.spanCommandShardCount,
  })
    .compose()
    // Deferred origin resolution for pure OTEL traces: reject pre-enqueue as
    // soon as the committed fold shows a resolved origin.
    .withProjectionSubscriber("originGate", {
      fold: "traceSummary",
      when: (event, context) => needsOriginResolution({ event, foldState: context.state }),
      delay: ORIGIN_GATE_DELAY_MS,
      ttl: ORIGIN_GATE_DEDUP_TTL_MS,
      handler: (event, context) => deps.originGateHandler(event, context),
    })
    // Evaluation dispatch, origin-guarded (spec + guards composed by
    // createEvaluationTriggerSubscriber).
    .withProjectionSubscriber(deps.evaluationTrigger.name, deps.evaluationTrigger.spec)
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
      handler: (event, context) => deps.customEvaluationSyncHandler(event, context),
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
      handler: (event, context) => deps.traceUpdateBroadcastHandler(event, context),
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
      handler: (event, context) => deps.simulationMetricsSyncHandler(event, context),
    })
    .withProjectionSubscriber("experimentMetricsSync", {
      fold: "traceSummary",
      when: (_event, context) => hasExperimentCostMetrics(context.state),
      delay: EXPERIMENT_METRICS_SYNC_DELAY_MS,
      ttl: EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
      handler: (event, context) => deps.experimentMetricsSyncHandler(event, context),
    })
    .withProjectionSubscriber("triggerMatch", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
      delay: 30_000,
      ttl: 30_000,
      handler: (event, context) => deps.automations.triggerMatchHandler(event, context),
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
      handler: (event, context) => deps.automations.graphActivityHandler(event, context),
    })
    // SSE notification after span storage commits; the subscriber-scoped
    // dedup key keeps it independent of traceUpdateBroadcast's window.
    .withProjectionSubscriber("spanStorageBroadcast", {
      map: "spanStorage",
      runIn: ["worker"],
      disabled: deps.broadcastDisabled,
      ttl: SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
      handler: (event, context) => deps.spanStorageBroadcastHandler(event, context),
    });

  if (deps.governanceKpisSync) {
    builder = builder.withProjectionSubscriber("governanceKpisSync", deps.governanceKpisSync);
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

  return builder.build();
}
