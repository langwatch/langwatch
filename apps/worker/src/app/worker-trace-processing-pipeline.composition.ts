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
import {
  createExperimentMetricsSyncHandler,
  createSimulationMetricsSyncHandler,
  createSpanStorageBroadcastHandler,
  createTraceUpdateBroadcastHandler,
  resolveSpanCommandShardCount,
  TraceTenantBroadcastPort,
  type TraceEvaluationLoopMetricsPort,
  type TraceProductAnalyticsPort,
  type TraceSpanSpoolPort,
} from "@langwatch/trace-server";
import {
  createGraphTriggerActivityHandler,
  type AutomationGraphActivityPort,
  type AutomationTraceTriggerCataloguePort,
  type AutomationTriggerMatchRecorderPort,
} from "@langwatch/automation-server";
import {
  createCodingAgentSpanFactsDispatchSubscriber,
  type CodingAgentTraceProcessingPort,
} from "@langwatch/coding-agent-server";
import type {
  ExecuteEvaluationCommandData,
  ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import { EvaluationNameAutoslugService } from "@langwatch/evaluation-server";
import type { QueueSendOptions } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { Logger } from "@langwatch/observability";
import type { WorkerConfig } from "../platform/config/worker.config";
import { createWorkerRecordSpanCommand } from "./worker-record-span.composition";
import { createWorkerTraceAlertTriggerHandler } from "./worker-trace-alert-trigger.composition";
import type { WorkerTraceCapabilityServices } from "./worker-trace-capability-services.composition";
import { createWorkerTraceEvaluationTrigger } from "./worker-trace-evaluation-trigger.composition";
import { createWorkerTraceNarrowPorts } from "./worker-trace-narrow-ports.composition";
import type { WorkerTrackedEventComposition } from "./worker-tracked-event.composition";

/**
 * The trace processing pipeline, composed and MOUNTED in this process out of
 * packages alone.
 *
 * ALL TWENTY-NINE ROUTING KEYS. The definition below registers every key
 * `trace_processing` declares in the byte-frozen `job-registry.json`, and the
 * two it does not register directly — `job:deferredOriginResolution` and
 * `job:datasetNormalize` — are the installer's own, registered as durable jobs
 * beside the pipeline. A definition short of one key is not a smaller
 * deployment: the queue rejects an unroutable job for redelivery rather than
 * dropping it, so that kind of work redelivers forever while the pods stay up,
 * the liveness probe answers and the queue depth grows.
 *
 * WHAT THIS FILE OWNS. It owns the DEFINITION — the names, the delays, the
 * dedup windows, the group keys and the `runIn` scopes — and, since the
 * conversion, the CONSTRUCTION of every handler behind those names.
 * `recordSpanCommand` and the fifteen subscriber handlers used to be
 * parameters, which was honest while the application still supplied them and
 * dishonest the moment this process became the one that routes the work: a
 * handler passed in is a handler this composition cannot promise exists.
 * Everything is now built here from substrates — a Prisma client, the queue's
 * Redis, a tenant-keyed ClickHouse client, this deployment's own variables,
 * object storage — and from the command proxies the sibling installers publish.
 *
 *     WorkerTraceProcessingPipeline
 *       |- EventingTracePipelineAdapter          the four projections
 *       |    |- TraceIoExtractionAdapter               (g1)
 *       |    |- TraceMediaReferenceAdapter             (g1)
 *       |    |- ModelCatalogTraceModelCostAdapter      (g1)
 *       |    |- TraceSpanNormalizationAdapter          (g1)
 *       |    |- leanForProjection                      (g1)
 *       |    `- RecordSpanCommand                      (g2)
 *       `- fifteen subscribers, each over a named collaborator
 *            |- originGate            the installer's deferred scheduler
 *            |- evaluationTrigger     monitors + flags + the evaluation queue
 *            |- customEvaluationSync  evaluation's reportEvaluation proxy
 *            |- trackedEventSync      the harvested span builder        (g4)
 *            |- traceUpdateBroadcast  the tenant pub/sub bridge
 *            |- projectMetadata       project write + product analytics +
 *            |                        topic's claimAndBootstrap proxy
 *            |- simulationMetricsSync scenario's computeRunMetrics proxy
 *            |- experimentMetricsSync experiment's proxy + its id lookup
 *            |- triggerMatch          the trace-alert subscriber         (g5)
 *            |- graphTriggerActivity  the graph vertical + analytics
 *            |- spanStorageBroadcast  the same pub/sub bridge
 *            |- governanceKpisSync    EE, supplied or declared absent    (g6)
 *            |- governanceOcsfEventsSync                                 (g6)
 *            `- codingAgentSpanFactsDispatch  normalization + the stored-span
 *                                             read                       (g3)
 *
 * THE STORES STAY PARAMETERS and that is not an inconsistency. A store is
 * where the projection COMMITS, and the same three stores are read back by the
 * trace read path; the composition root that opens the ClickHouse client owns
 * them so both readers and this writer hold one instance.
 */

/** A subscriber handler on the committed traceSummary fold state. */
export type WorkerTraceSummaryHandler = (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void>;

/**
 * The three cross-pipeline payloads, taken from the subscriber that sends them
 * rather than from the owning feature's contract package.
 *
 * Deliberate: what this composition must agree with is the shape the SUBSCRIBER
 * dispatches, and taking it from there means a change to that shape is a
 * typecheck failure here instead of three packages that agree with each other
 * and not with the caller. It also keeps three contract packages off this
 * process's dependency list for three type aliases.
 */
type ComputeRunMetricsData = Parameters<
  Parameters<typeof createSimulationMetricsSyncHandler>[0]["computeRunMetrics"]
>[0];
type ComputeExperimentRunMetricsData = Parameters<
  Parameters<typeof createExperimentMetricsSyncHandler>[0]["computeExperimentRunMetrics"]
>[0];
type ContributeSpanFactsData = Parameters<
  Parameters<typeof createCodingAgentSpanFactsDispatchSubscriber>[0]["contributeSpanFacts"]
>[0];

/**
 * The cross-feature command proxies this pipeline's subscribers dispatch
 * through.
 *
 * Every one of them is a LATE-BOUND proxy published by a sibling installer,
 * not a command: the pipelines register in a fixed order and each of these
 * belongs to a pipeline that registers after this one. A `Deferred` resolves
 * during installation, which completes before the consumer claims its first
 * job.
 */
export type WorkerTraceProcessingCommands = Readonly<{
  /** Evaluation's dispatch, for the online-evaluation trigger. */
  executeEvaluation: (
    data: ExecuteEvaluationCommandData,
    sendOptions?: QueueSendOptions<ExecuteEvaluationCommandData>,
  ) => Promise<void>;
  /** Evaluation's result write, for evaluations an SDK reported on a span. */
  reportEvaluation: (data: ReportEvaluationCommandData) => Promise<void>;
  /** Scenario's per-run metrics, published once a simulation trace settles. */
  computeRunMetrics: (data: ComputeRunMetricsData) => Promise<void>;
  /** Experiment's per-run metrics, and the run-id to experiment-id lookup. */
  computeExperimentRunMetrics: (data: ComputeExperimentRunMetricsData) => Promise<void>;
  lookupExperimentId: (tenantId: string, runId: string) => Promise<string | null>;
  /** Topic's rate-limited clustering claim, on a project's first real ingest. */
  bootstrapTopicClustering: (projectId: string) => Promise<void>;
  /** Coding agent's bounded span facts (ADR-056/069). */
  contributeSpanFacts: (data: ContributeSpanFactsData) => Promise<void>;
  /** Automation's durable trigger match, behind its own late-bound recorder. */
  triggerMatches: AutomationTriggerMatchRecorderPort;
}>;

/** The projection and rollup writers, owned by the root that opens ClickHouse. */
export type WorkerTraceProcessingStores = Readonly<{
  spanAppendStore: AppendStore<NormalizedSpan>;
  /** ADR-034 Phase 1: per-span rollup writer. */
  traceAnalyticsRollupAppendStore: EventingTracePipelineAdapterOptions["rollupStore"];
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** ADR-034 Phase 2: slim per-trace fold writer. */
  traceAnalyticsStore: EventingTracePipelineAdapterOptions["derivedStore"];
}>;

export type WorkerTraceProcessingCompositionOptions = Readonly<{
  config: WorkerConfig;
  /** The four read-side capability services, over the one Prisma client. */
  services: WorkerTraceCapabilityServices;
  featureFlags: FeatureFlagService;
  traceCanonicalisation: TraceCanonicalisationService;
  stores: WorkerTraceProcessingStores;
  commands: WorkerTraceProcessingCommands;
  /** The project's trace automations, for `reactor:triggerMatch`. */
  traceTriggers: AutomationTraceTriggerCataloguePort;
  /** The graph-alert vertical, absent on a deployment that can send no mail. */
  graphActivity?: AutomationGraphActivityPort;
  /** The one product-usage sink, for `first_trace_integrated`. */
  productAnalytics: TraceProductAnalyticsPort;
  /** The tenant pub/sub bridge; absent disables the two broadcast subscribers. */
  broadcast?: TraceTenantBroadcastPort;
  /** The ADR-022 claim check, for a span whose payload travelled out of band. */
  spool?: TraceSpanSpoolPort;
  /** `subscriber:codingAgentSpanFactsDispatch`'s normalization and span read. */
  codingAgentTraces: CodingAgentTraceProcessingPort;
  /** `reactor:trackedEventSync`'s builder, plus the late bind to `recordSpan`. */
  trackedEvents: WorkerTrackedEventComposition;
  /** EE governance rollups, composed as full subscriber specs by the caller so
   *  this OSS pipeline stays free of `@ee` imports. */
  governanceKpisSync?: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
  governanceOcsfEventsSync?: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
  /** Where the evaluation-trigger loop guard reports itself. */
  evaluationLoopMetrics?: TraceEvaluationLoopMetricsPort;
  logger?: Logger;
}>;

/**
 * Everything `createWorkerTraceProcessingPipeline` needs, once the handlers
 * exist. `originGateHandler` is absent by design: it is built from the
 * deferred-origin scheduler, which only exists at `build` time.
 */
export interface WorkerTraceProcessingPipelineDeps {
  recordSpanCommand: RecordSpanCommand;
  traceCanonicalisation: TraceCanonicalisationService;
  spanAppendStore: AppendStore<NormalizedSpan>;
  traceAnalyticsRollupAppendStore: EventingTracePipelineAdapterOptions["rollupStore"];
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
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
  governanceKpisSync?: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
  governanceOcsfEventsSync?: SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" };
  /** Cross-pipeline dispatchers (e.g. coding-agent span-facts, ADR-056). */
  subscribers?: EventSubscriberDefinition<TraceProcessingEvent>[];
}

/**
 * Everything `createWorkerTraceProcessingPipeline` is handed by the class
 * above, minus the one thing only `build` can supply.
 */
export type WorkerTraceProcessingPipelineOptions = Omit<
  WorkerTraceProcessingPipelineDeps,
  "originGateHandler"
>;

export class WorkerTraceProcessingPipeline extends TraceProcessingPipelinePort {
  static create(
    options: WorkerTraceProcessingCompositionOptions,
  ): WorkerTraceProcessingPipeline {
    return new WorkerTraceProcessingPipeline(composeWorkerTraceProcessingDeps(options));
  }

  private constructor(private readonly deps: WorkerTraceProcessingPipelineOptions) {
    super();
  }

  build(options: { deferredOrigins: TraceDeferredOriginSchedulerPort }) {
    return createWorkerTraceProcessingPipeline({
      ...this.deps,
      originGateHandler: createOriginGateHandler(options.deferredOrigins),
    });
  }
}

/**
 * Every collaborator behind the fifteen names, built from substrates.
 *
 * Read this as the answer to "what does one trace actually touch": four
 * capability services over Postgres, one ClickHouse client, one Redis, this
 * deployment's own variables, its object storage, and seven command proxies
 * belonging to six other features.
 */
function composeWorkerTraceProcessingDeps(
  options: WorkerTraceProcessingCompositionOptions,
): WorkerTraceProcessingPipelineOptions {
  const ports = createWorkerTraceNarrowPorts({
    projects: options.services.projects,
    monitors: options.services.monitors,
    modelProviders: options.services.modelCosts,
    productAnalytics: options.productAnalytics,
  });

  const evaluationTrigger = createWorkerTraceEvaluationTrigger({
    monitors: options.services.monitors,
    featureFlags: options.featureFlags,
    sendEvaluation: options.commands.executeEvaluation,
    ...(options.evaluationLoopMetrics ? { metrics: options.evaluationLoopMetrics } : {}),
  }).subscriber();

  const trackedEvents = options.trackedEvents;

  return {
    recordSpanCommand: createWorkerRecordSpanCommand({
      config: options.config,
      services: options.services,
      featureFlags: options.featureFlags,
      ...(options.spool ? { spool: options.spool } : {}),
    }),
    traceCanonicalisation: options.traceCanonicalisation,
    spanAppendStore: options.stores.spanAppendStore,
    traceAnalyticsRollupAppendStore: options.stores.traceAnalyticsRollupAppendStore,
    traceSummaryStore: options.stores.traceSummaryStore,
    traceAnalyticsStore: options.stores.traceAnalyticsStore,
    evaluationTrigger,
    customEvaluationSyncHandler: CustomEvaluationSync.createCustomEvaluationSyncHandler({
      reportEvaluation: options.commands.reportEvaluation,
      // Evaluation's own slug derivation, not a second one: the id it produces
      // is the row key an SDK-reported evaluation is upserted under, and two
      // spellings would file the same evaluator's results under two evaluators.
      deriveEvaluatorId: (name: string) => EvaluationNameAutoslugService.create().derive(name),
    }),
    trackedEventSyncHandler: trackedEvents.handler,
    traceUpdateBroadcastHandler: createTraceUpdateBroadcastHandler({
      broadcast: options.broadcast ?? new WorkerInertTraceBroadcast(),
    }),
    projectMetadataHandler: ProjectMetadataSync.createProjectMetadataHandler({
      projects: ports.projects,
      recordProductEvent: (input) => ports.productAnalytics.record(input),
      bootstrapTopicClustering: options.commands.bootstrapTopicClustering,
    }),
    simulationMetricsSyncHandler: createSimulationMetricsSyncHandler({
      computeRunMetrics: options.commands.computeRunMetrics,
    }),
    experimentMetricsSyncHandler: createExperimentMetricsSyncHandler({
      computeExperimentRunMetrics: options.commands.computeExperimentRunMetrics,
      lookupExperimentId: options.commands.lookupExperimentId,
    }),
    automations: {
      triggerMatchHandler: createWorkerTraceAlertTriggerHandler({
        triggers: options.traceTriggers,
        matches: options.commands.triggerMatches,
      }),
      graphActivityHandler: options.graphActivity
        ? createGraphTriggerActivityHandler(options.graphActivity)
        : async () => void 0,
    },
    spanStorageBroadcastHandler: createSpanStorageBroadcastHandler({
      broadcast: options.broadcast ?? new WorkerInertTraceBroadcast(),
    }),
    broadcastDisabled: !options.broadcast,
    spanCommandShardCount: resolveSpanCommandShardCount(options.config.processing.traceSpanShards),
    ...(options.governanceKpisSync ? { governanceKpisSync: options.governanceKpisSync } : {}),
    ...(options.governanceOcsfEventsSync
      ? { governanceOcsfEventsSync: options.governanceOcsfEventsSync }
      : {}),
    subscribers: [
      createCodingAgentSpanFactsDispatchSubscriber({
        contributeSpanFacts: options.commands.contributeSpanFacts,
        traces: options.codingAgentTraces,
      }),
    ],
  };
}

/**
 * The publisher a process with no Redis hands the two broadcast subscribers.
 *
 * They stay REGISTERED and become inert, which is the difference that matters:
 * `disabled` keeps the routing key claimed so a broadcast job staged by the
 * other graph is still routed and dropped here, rather than redelivered
 * forever by a consumer that does not know the name.
 */
class WorkerInertTraceBroadcast extends TraceTenantBroadcastPort {
  async broadcastToTenant(): Promise<void> {}
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
