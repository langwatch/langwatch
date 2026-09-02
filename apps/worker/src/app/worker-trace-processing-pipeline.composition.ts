import {
  type AppendStore,
  type EventSubscriberDefinition,
  type FoldProjectionStore,
  type SubscriberSpec,
  type TriggerContext,
  throttledWindow,
} from "@langwatch/eventing";
import {
  GRAPH_TRIGGER_REAL_TIME_DEBOUNCE_MS,
  graphTriggerActivityGroupKey,
} from "@langwatch/automation-server";
import {
  createOriginGateHandler,
  CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
  CUSTOM_EVAL_SYNC_DELAY_MS,
  CustomEvaluationSync,
  type EventingTracePipelineAdapterOptions,
  EventingTracePipelineAdapter,
  EXPERIMENT_METRICS_SYNC_DEDUP_TTL_MS,
  EXPERIMENT_METRICS_SYNC_DELAY_MS,
  hasExperimentCostMetrics,
  hasSimulationMetrics,
  leanForProjection,
  ModelCatalogTraceModelCostAdapter,
  needsOriginResolution,
  ORIGIN_GATE_DEDUP_TTL_MS,
  ORIGIN_GATE_DELAY_MS,
  PROJECT_METADATA_WINDOW_MS,
  ProjectMetadataSync,
  RecordSpanCommand,
  SIMULATION_METRICS_SYNC_DEDUP_TTL_MS,
  SIMULATION_METRICS_SYNC_DELAY_MS,
  SPAN_STORAGE_BROADCAST_DEDUP_TTL_MS,
  TRACE_UPDATE_BROADCAST_WINDOW_MS,
  type TraceDeferredOriginSchedulerPort,
  TraceIoExtractionAdapter,
  TraceMediaReferenceAdapter,
  TraceProcessingPipelinePort,
  TraceSpanNormalizationAdapter,
  type TraceSummarySubscriber,
  TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
  TRACKED_EVENT_SYNC_DELAY_MS,
  TrackedEventSync,
} from "@langwatch/trace-server";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  type NormalizedSpan,
  type TraceCanonicalisationService,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

/**
 * The trace processing pipeline, composed in this process out of packages
 * alone.
 *
 * STAGED, NOT MOUNTED. The application still assembles `capabilities.trace`
 * and still registers all twenty-nine of `trace_processing`'s routing keys, so
 * nothing here runs in production and no production caller reaches it. What
 * has to be true today is the thing the step-(g) attempt discovered was not:
 * that this process can build the pipeline DEFINITION. It could not, because
 * four of its collaborators were application-only and were never in the census
 * — the input/output extraction, the media references, the fold-time cost and
 * the lean projection payload — and the two modules that register the keys
 * (`AppTraceProjectionsAdapter` and `createTraceProcessingPipeline`) were
 * application-only on top of them. All four are now package code, and this is
 * the two modules as one.
 *
 * WHAT IT AWAITED WAS `command:recordSpan`'s service cascade, and (g2) has
 * cleared it. `recordSpanCommand` is now buildable in this process:
 * `createWorkerRecordSpanCommand` composes the whole command from the one
 * Prisma client, this deployment's own variables and the stored-object runtime,
 * because each of the four features publishes the READ half the record path
 * uses — `ProjectMetadataService`, `DataPrivacyResolutionService`,
 * `ModelCostCatalogService` and `MonitorCatalogService` — rather than only the
 * wide service its write half needs. It stays a parameter here for the same
 * reason every store does: this composition owns the DEFINITION, not the graph.
 *
 * WHAT IS STILL OUTSTANDING for the conversion, none of it this file's:
 * `reactor:trackedEventSync`'s `getApp()` (g4),
 * `subscriber:codingAgentSpanFactsDispatch`'s normalized-span read (g3),
 * `job:datasetNormalize`'s composition (g7), `reactor:triggerMatch` (g5), the
 * two EE governance rollups (g6), and `AnalyticsService`, which the graph
 * subscriber reads through and which was never a wall.
 *
 *     WorkerTraceProcessingPipeline
 *       |- EventingTracePipelineAdapter        (trace-server owns it)
 *       |    |- TraceIoExtractionAdapter       harvested by (g1)
 *       |    |- TraceMediaReferenceAdapter     harvested by (g1)
 *       |    |- ModelCatalogTraceModelCostAdapter   harvested by (g1)
 *       |    |- TraceSpanNormalizationAdapter  harvested by (g1)
 *       |    `- leanForProjection              harvested by (g1)
 *       `- the fifteen subscriber registrations, taken by parameter
 *
 * The stores, the record-span command and every subscriber handler stay
 * parameters. This composition owns the DEFINITION, not the graph.
 */

/** A subscriber handler on the committed traceSummary fold state. */
export type WorkerTraceSummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

export interface WorkerTraceProcessingPipelineDeps {
  recordSpanCommand: RecordSpanCommand;
  traceCanonicalisation: TraceCanonicalisationService;
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer. */
  traceAnalyticsRollupAppendStore: EventingTracePipelineAdapterOptions["rollupStore"];
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer. */
  traceAnalyticsStore: EventingTracePipelineAdapterOptions["derivedStore"];
  originGateHandler: WorkerTraceSummaryHandler;
  evaluationTrigger: TraceSummarySubscriber;
  customEvaluationSyncHandler: WorkerTraceSummaryHandler;
  trackedEventSyncHandler: WorkerTraceSummaryHandler;
  traceUpdateBroadcastHandler: WorkerTraceSummaryHandler;
  projectMetadataHandler: WorkerTraceSummaryHandler;
  simulationMetricsSyncHandler: WorkerTraceSummaryHandler;
  experimentMetricsSyncHandler: WorkerTraceSummaryHandler;
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
   * `traceId:<shard>` groups so a hot trace drains in parallel.
   */
  spanCommandShardCount?: number;
  /** EE governance rollups, composed as full subscriber specs by the caller so
   *  this OSS pipeline stays free of `@ee` imports. */
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
 * Everything the composition root supplies. `originGateHandler` is absent by
 * design: it is built from the deferred-origin scheduler, which only exists at
 * `build` time, so requiring it here would ask the caller for something it
 * cannot have yet.
 */
export type WorkerTraceProcessingPipelineOptions = Omit<
  WorkerTraceProcessingPipelineDeps,
  "originGateHandler"
>;

export class WorkerTraceProcessingPipeline extends TraceProcessingPipelinePort {
  static create(options: WorkerTraceProcessingPipelineOptions): WorkerTraceProcessingPipeline {
    return new WorkerTraceProcessingPipeline(options);
  }

  private constructor(private readonly options: WorkerTraceProcessingPipelineOptions) {
    super();
  }

  build(options: { deferredOrigins: TraceDeferredOriginSchedulerPort }) {
    return createWorkerTraceProcessingPipeline({
      ...this.options,
      originGateHandler: createOriginGateHandler(options.deferredOrigins),
    });
  }
}

/**
 * The projection half: the four projections and the record-span command, over
 * the four collaborators this process now builds for itself.
 *
 * Frozen twin of the application's `AppTraceProjectionsAdapter.compose()`. The
 * two are one function here because they were never two concerns — the
 * application split them so the runtime could also be handed to the
 * standalone span-storage and rollup projections, and this process composes
 * those through `TraceProjectionRuntimeService` directly.
 */
function composeTraceProjections(deps: WorkerTraceProcessingPipelineDeps) {
  return EventingTracePipelineAdapter.create({
    canonicalisation: deps.traceCanonicalisation,
    spanStore: deps.spanAppendStore,
    summaryStore: deps.traceSummaryStore,
    derivedStore: deps.traceAnalyticsStore,
    rollupStore: deps.traceAnalyticsRollupAppendStore,
    recordSpanCommand: deps.recordSpanCommand,
    ...(deps.spanCommandShardCount === undefined
      ? {}
      : { spanCommandShardCount: deps.spanCommandShardCount }),
    ioExtraction: TraceIoExtractionAdapter.create(deps.traceCanonicalisation),
    mediaReferences: TraceMediaReferenceAdapter.create(),
    modelCosts: ModelCatalogTraceModelCostAdapter.create(),
    spanNormalization: TraceSpanNormalizationAdapter.create(deps.traceCanonicalisation),
    prepareEventForProjection: leanForProjection,
  }).build();
}

/**
 * The whole `trace_processing` definition: the projections above plus the
 * fifteen subscriber registrations. Byte-for-byte the same registrations, in
 * the same order, with the same delays, dedup windows, group keys and
 * `runIn` scopes as the application's `createTraceProcessingPipeline` — the
 * queue routes on these names, and a name spelled differently here is work the
 * standalone graph would never pick up.
 */
export function createWorkerTraceProcessingPipeline(deps: WorkerTraceProcessingPipelineDeps) {
  let builder = composeTraceProjections(deps)
    // Deferred origin resolution for pure OTEL traces: reject pre-enqueue as
    // soon as the committed fold shows a resolved origin.
    .withProjectionSubscriber("originGate", {
      fold: "traceSummary",
      when: (event, context) => needsOriginResolution({ event, foldState: context.state }),
      delay: ORIGIN_GATE_DELAY_MS,
      ttl: ORIGIN_GATE_DEDUP_TTL_MS,
      handler: (event, context) => deps.originGateHandler(event, context),
    })
    // Evaluation dispatch, origin-guarded.
    .withProjectionSubscriber(deps.evaluationTrigger.name, deps.evaluationTrigger.spec)
    // Custom SDK evaluations reported on spans. Keeps the subscriber-era name
    // so jobs staged before a deploy dispatch into this registration after it.
    .withProjectionSubscriber("customEvaluationSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: CustomEvaluationSync.hasSyncableEvaluations,
      delay: CUSTOM_EVAL_SYNC_DELAY_MS,
      ttl: CUSTOM_EVAL_SYNC_DEDUP_TTL_MS,
      dedupId: CustomEvaluationSync.customEvaluationSyncDedupId,
      handler: (event, context) => deps.customEvaluationSyncHandler(event, context),
    })
    // Live span feedback (langwatch.event) -> tracked event, same path as the
    // REST track_event endpoint; deterministic ids keep retries idempotent.
    .withProjectionSubscriber("trackedEventSync", {
      fold: "traceSummary",
      events: [SPAN_RECEIVED_EVENT_TYPE],
      when: TrackedEventSync.hasSyncableFeedback,
      delay: TRACKED_EVENT_SYNC_DELAY_MS,
      ttl: TRACKED_EVENT_SYNC_DEDUP_TTL_MS,
      dedupId: TrackedEventSync.trackedEventSyncDedupId,
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
    // project (the two must pair).
    .withProjectionSubscriber("projectMetadata", {
      fold: "traceSummary",
      runIn: ["worker"],
      when: (_event, context) => ProjectMetadataSync.isRealFirstIngest(context.state),
      groupKeyFn: ProjectMetadataSync.projectMetadataGroupKey,
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
      // in per-trace groups and ran as a parallel storm.
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
