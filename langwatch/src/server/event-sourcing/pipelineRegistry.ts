import {
  type EnterprisePipelineSetConfig,
  registerEnterprisePipelineSet,
} from "@ee/event-sourcing/pipelineSet";
import {
  createGatewayBudgetDebitsProjection,
  createGovernanceKpisProjection,
  createGovernanceOcsfEventsProjection,
  type GatewayBudgetDebitsProjectionDeps,
  type GovernanceKpisProjectionDeps,
  type GovernanceOcsfEventsProjectionDeps,
} from "@ee/governance/projections/governanceProjections.composition";
import { createTraceAlertTriggerMatchHandler } from "@ee/governance/subscribers/traceAlertTriggerMatch.subscriber";
import { createVirtualKeyLastUsedSubscriber } from "@ee/governance/subscribers/virtualKeyLastUsed.subscriber";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import { reapExpiredLangySessionApiKeys } from "~/server/app-layer/langy/langyApiKey";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { DatasetRepository } from "~/server/datasets/dataset.repository";
import {
  createDatasetNormalizeHandler,
  type DatasetNormalizePayload,
} from "~/server/datasets/dataset-normalize.job";
import { registerDatasetNormalizeEnqueue } from "~/server/datasets/dataset-normalize.queue";
import { getDatasetStorage } from "~/server/datasets/dataset-storage";
import { abortManager } from "~/server/experiments-v3/execution/abortManager";
import { runStateManager } from "~/server/experiments-v3/execution/runStateManager";
import { featureFlagService } from "~/server/featureFlag";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { TriggerService } from "../app-layer/automations/trigger.service";
import type { BillingCheckpointService } from "../app-layer/billing/billingCheckpoint.service";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import type { CodingAgentSessionRepository } from "../app-layer/coding-agent/repositories/coding-agent-session.repository";
import type { CodingAgentTraceSessionRepository } from "../app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "../app-layer/coding-agent/repositories/session-metric-series.repository";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import { offloadInputsIfOversized } from "../app-layer/evaluations/evaluation-inputs-offload";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { EvaluationAnalyticsRepository } from "../app-layer/evaluations/repositories/evaluation-analytics.repository";
import type { EvaluationAnalyticsRollupRepository } from "../app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import type { LangyTitleGenerator } from "../app-layer/langy/langy-title-generation.service";
import {
  mintLangySessionApiKeyForUser,
  revokeLangySessionApiKey,
} from "../app-layer/langy/langyApiKey";
import type { LangyWorkerPort } from "../app-layer/langy/langyWorker";
import type { LangyTurnAdmissionRepository } from "../app-layer/langy/repositories/langy-turn-admission.repository";
import type { LangyTokenBuffer } from "../app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnHandoffStore } from "../app-layer/langy/streaming/langyTurnHandoff";
import type { CanonicalLogRecordRepository } from "../app-layer/logs/repositories/canonical-log-record.repository";
import type { MetricDataPointRepository } from "../app-layer/metrics/repositories/metric-data-point.repository";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { OrganizationService } from "../app-layer/organizations/organization.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import { createRateLimitedBootstrap } from "../app-layer/topic-clustering/topicClusteringBootstrapGate";
import type { TraceAnalyticsRepository } from "../app-layer/traces/repositories/trace-analytics.repository";
import type { TraceAnalyticsRollupRepository } from "../app-layer/traces/repositories/trace-analytics-rollup.repository";
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "../app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import type { TraceSummaryData } from "../app-layer/traces/types";
import type { RetentionPolicyResolver } from "../data-retention/retentionPolicyResolver";
import type { AutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.adapter";
import { createEvaluationAlertTriggerMatchHandler } from "../event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { createGraphTriggerActivityHandler } from "../event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import type { TopicClusteringRunPort } from "../event-sourcing/pipelines/topic-clustering-processing/process-manager";
import { createScenarioExecutionDispatcher } from "../scenarios/execution/execution-dispatcher";
import { executeScenarioRun } from "../scenarios/scenario.processor";
import { ScenarioService } from "../scenarios/scenario.service";
import { ScenarioFailureHandler } from "../scenarios/scenario-failure-handler";
import { type CommandDispatcher, Deferred } from "./deferred";
import { createTenantId } from "./domain/tenantId";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import { createAutomationsPipeline } from "./pipelines/automations/pipeline";
import { createBillingReportingPipeline } from "./pipelines/billing-reporting/pipeline";
import { createBlobMaintenancePipeline } from "./pipelines/blob-maintenance/pipeline";
import { createCodingAgentProcessingPipeline } from "./pipelines/coding-agent-processing/pipeline";
import { createCodingAgentSpanFactsDispatchSubscriber } from "./pipelines/coding-agent-processing/subscribers/codingAgentSpanFactsDispatch.subscriber";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./pipelines/evaluation-processing/pipeline";
import type { EvaluationAnalyticsData } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import { EvaluationAnalyticsStore } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.store";
import { EvaluationAnalyticsRollupAppendStore } from "./pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.store";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import type { ClickHouseExperimentRunResultRecord } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import { createLangyConversationProcessingPipeline } from "./pipelines/langy-conversation-processing/pipeline";
import type { LangyAnalyticsEventProjectionRecord } from "./pipelines/langy-conversation-processing/projections/langyAnalyticsEvent.mapProjection";
import { createLangyMaintenancePipeline } from "./pipelines/langy-maintenance/pipeline";
import { resolveLogCommandShardCount as resolveCanonicalLogCommandShardCount } from "./pipelines/log-processing/canonicalLog";
import { createLogProcessingPipeline } from "./pipelines/log-processing/pipeline";
import { resolveMetricCommandShardCount } from "./pipelines/metric-processing/canonical/shards";
import { createMetricProcessingPipeline } from "./pipelines/metric-processing/pipeline";
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
import type { ComputeRunMetricsCommandData } from "./pipelines/simulation-processing/schemas/commands";
import { SIMULATION_PROJECTION_VERSIONS } from "./pipelines/simulation-processing/schemas/constants";
import { createTopicClusteringProcessingPipeline } from "./pipelines/topic-clustering-processing/pipeline";
import type { TopicClusteringRunHistoryData } from "./pipelines/topic-clustering-processing/projections/topicClusteringRunHistory.foldProjection";
import type { TopicClusteringRunStatusData } from "./pipelines/topic-clustering-processing/projections/topicClusteringRunStatus.foldProjection";
import type { TopicModelData } from "./pipelines/topic-clustering-processing/projections/topicModel.foldProjection";
import { resolveSpanCommandShardCount } from "./pipelines/trace-processing/commands/spanCommandGroupKey";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "./pipelines/trace-processing/pipeline";
import type { DerivedTraceEvent } from "./pipelines/trace-processing/projections/services/trace-events.derivation";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import type { TraceAnalyticsData } from "./pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "./pipelines/trace-processing/projections/traceAnalytics.store";
import { TraceAnalyticsRollupAppendStore } from "./pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createCustomEvaluationSyncReactor } from "./pipelines/trace-processing/reactors/customEvaluationSync.reactor";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import {
  createDeferredOriginHandler,
  createOriginGateReactor,
  DEFERRED_CHECK_DELAY_MS,
  type DeferredOriginPayload,
  makeDeferredJobId,
} from "./pipelines/trace-processing/reactors/originGate.reactor";
import { createProjectMetadataReactor } from "./pipelines/trace-processing/reactors/projectMetadata.reactor";
import { createSimulationMetricsSyncReactor } from "./pipelines/trace-processing/reactors/simulationMetricsSync.reactor";
import { createSpanStorageBroadcastReactor } from "./pipelines/trace-processing/reactors/spanStorageBroadcast.reactor";
import { createTraceUpdateBroadcastReactor } from "./pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";
import type { ResolveOriginCommandData } from "./pipelines/trace-processing/schemas/commands";
import type { ProcessStore } from "./process-manager";
import { CachedFoldStore } from "./projections/cachedFoldStore";
import type { FoldCacheClient } from "./projections/foldCache/foldCacheClient";
import type { FoldProjectionStore } from "./projections/foldProjection.types";
import type { AppendStore } from "./projections/mapProjection.types";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import type { StateProjectionStore } from "./projections/stateProjection.types";
import { BlobSweeper } from "./queues/groupQueue/blobSweeper";
import {
  generateKillSwitchKey,
  type KillSwitchComponentType,
} from "./utils/killSwitch";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

/**
 * Creates an in-memory setTimeout-based fallback for deferred job processing.
 * Used when the event-sourcing queue is unavailable (e.g. no Redis).
 */
function createInMemoryDeferredFallback<P>({
  makeId,
  delayMs,
  process,
  logContext,
  errorMessage,
}: {
  makeId?: (payload: P) => string;
  delayMs: number;
  process: (payload: P) => Promise<void>;
  logContext: (payload: P) => Record<string, unknown>;
  errorMessage: string;
}): (payload: P) => Promise<void> {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  return async (payload: P) => {
    if (makeId) {
      const dedupKey = makeId(payload);
      if (pending.has(dedupKey)) return;
      const timer = setTimeout(async () => {
        pending.delete(dedupKey);
        try {
          await process(payload);
        } catch (error) {
          logger.error({ ...logContext(payload), error }, errorMessage);
        }
      }, delayMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      pending.set(dedupKey, timer);
    } else {
      const timer = setTimeout(async () => {
        try {
          await process(payload);
        } catch (error) {
          logger.error({ ...logContext(payload), error }, errorMessage);
        }
      }, delayMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }
  };
}

/**
 * Pre-constructed repositories, resolved at the composition root (presets.ts).
 * The registry consumes these directly — no ClickHouse client resolution here.
 */
export interface PipelineRepositories {
  /** Primary replica for read-after-write consistency. */
  simulationRunState: SimulationRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  experimentRunState: ExperimentRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  traceSummaryFold: TraceSummaryRepository;
  canonicalLogStorage: CanonicalLogRecordRepository;
  /** ADR-056: the session-aggregate row + the (trace → session) map. */
  codingAgentSession: CodingAgentSessionRepository;
  codingAgentTraceSession: CodingAgentTraceSessionRepository;
  /** ADR-056 §5: converged per-series metric totals per session. */
  sessionMetricSeries: SessionMetricSeriesRepository;
  metricDataPointStorage: MetricDataPointRepository;
  /** ADR-034 Phase 1: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-034 Phase 2: slim per-trace analytics repository (dual-tap). */
  traceAnalytics: TraceAnalyticsRepository;
  /** ADR-034 Phase 6: per-evaluation rollup repository. */
  evaluationAnalyticsRollup: EvaluationAnalyticsRollupRepository;
  /** ADR-034 Phase 6: slim per-evaluation analytics repository. */
  evaluationAnalytics: EvaluationAnalyticsRepository;
  experimentRunItemStorage: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** Direct Postgres operational projection; deliberately bypasses Redis. */
  langyConversationState: StateProjectionStore<LangyConversationStateData>;
  /** Direct Postgres per-turn operational projection. */
  langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  /** Postgres per-message operational projection. */
  langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free ClickHouse event-grain analytics. */
  langyAnalyticsEventStorage: AppendStore<LangyAnalyticsEventProjectionRecord>;
  /**
   * Durable process inbox, state, and outbox persistence — SHARED across
   * every process manager (the ProcessManager* tables are generic; each
   * domain's dispatcher scopes its leases via `processNames`).
   */
  processStore: ProcessStore;
  /** Per-project topic clustering run status (ADR-051, Postgres). */
  topicClusteringRunStatus: StateProjectionStore<TopicClusteringRunStatusData>;
  /** Per-project topic clustering run history (audit; bounded). */
  topicClusteringRunHistory: StateProjectionStore<TopicClusteringRunHistoryData>;
  /** Write-through topic model store (the Topic table + cursor row). */
  topicModel: StateProjectionStore<TopicModelData>;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  langyTurnAdmission: LangyTurnAdmissionRepository;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  repositories: PipelineRepositories;
  redis: Redis | Cluster;
  /**
   * ADR-077 §3: the cache tier fold projections read and write through, already
   * chosen by the composition root. The registry composes stores with it and
   * never decides what backs it.
   */
  foldCacheClient: FoldCacheClient;
  broadcast: BroadcastService;
  langy: {
    buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
    handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
    worker: Pick<LangyWorkerPort, "dispatch">;
    titleGenerator: LangyTitleGenerator;
  };
  topicClustering: {
    /** Runs one clustering page (the ADR-051 effect's domain function). */
    runPort: TopicClusteringRunPort;
  };
  enterprisePipelines: EnterprisePipelineSetConfig;
  projects: ProjectService;
  monitors: MonitorService;
  triggers: TriggerService;
  automations: { ports: AutomationDispatchPorts };
  prisma: PrismaClient;
  traces: {
    summary: TraceSummaryService;
    spans: SpanStorageService;
  };
  evaluations: {
    runs: EvaluationRunService;
    execution: EvaluationExecutionService;
  };
  organizations: OrganizationService;
  costRecorder: EvaluationCostRecorder;
  billingCheckpoints: BillingCheckpointService;
  usageReportingService?: UsageReportingService;
  gatewayBudgetSync?: GatewayBudgetDebitsProjectionDeps;
  /**
   * ADR-022: BlobStore for RecordSpanCommand spool reconstitution.
   * When provided, the trace-processing pipeline wires it into RecordSpanCommand
   * so oversized commands (> 256 KB) are fetched from S3 and the spool is
   * best-effort DELETEd after event_log INSERT succeeds.
   */
  blobStore?: BlobStore;
  governanceKpisSync?: GovernanceKpisProjectionDeps;
  governanceOcsfEventsSync?: GovernanceOcsfEventsProjectionDeps;
  retentionPolicyResolver?: RetentionPolicyResolver;
}

/**
 * Composition root for all event-sourcing pipelines.
 *
 * Creates store adapters, builds reactors and command classes, then registers
 * all pipelines with the EventSourcing runtime. Pipelines receive only
 * store interfaces and pre-built artifacts — never raw deps like prisma or ClickHouse clients.
 */
export class PipelineRegistry {
  constructor(private readonly deps: PipelineRegistryDeps) {}

  /**
   * ADR-051: the trace pipeline's projectMetadata reactor bootstraps a
   * project's clustering schedule on its first real trace, but the topic
   * clustering pipeline (whose command it dispatches) registers later —
   * late-bound like the other cross-pipeline dispatchers.
   */
  private readonly bootstrapTopicClustering = new Deferred<
    (projectId: string) => Promise<void>
  >("bootstrapTopicClustering");

  registerAll() {
    // TODO: Customer.io nurture sync is implemented and registered nowhere, so
    // no generation of it runs today. The counting strategy (per-event
    // ClickHouse queries) still has to be finalised before it is switched on.
    //
    // The ADR-075 subscribers are now the only implementation — the reactors
    // they replaced are gone — and none of them is constructed here:
    //   trace-processing/subscribers/customerIoTraceSync.subscriber.ts
    //   evaluation-processing/subscribers/customerIoEvaluationSync.subscriber.ts
    //   simulation-processing/subscribers/customerIoSimulationSync.subscriber.ts
    //
    // Switching it on means each pipeline building its own from its `Deps` and
    // mounting it with `.withEventSubscriber` (ADR-077 Rule 1) — not this file
    // constructing three more handlers.

    const traceSummaryStore = new CachedFoldStore<TraceSummaryData>(
      new TraceSummaryStore(this.deps.repositories.traceSummaryFold),
      this.deps.foldCacheClient,
      { keyPrefix: "trace_summaries" },
    );

    const automationPorts = this.deps.automations.ports;
    const graphActivityHandler = createGraphTriggerActivityHandler({
      triggers: this.deps.triggers,
      evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
    });
    const automationPipeline = this.deps.eventSourcing.register(
      createAutomationsPipeline({
        dispatch: automationPorts.settlementDeps,
        sweep: {
          decideSweepCandidates: automationPorts.decideSweepCandidates,
          evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
        prune: {
          pruneExpired: automationPorts.pruneWebhookDeliveries,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );
    // Queue-infrastructure maintenance. Registered unconditionally: the runtime
    // only arms the schedule where `roleRunsWorkers` holds, so on web this is
    // inert shape rather than a second fleet sweeping the same keyspace.
    const blobSweeper = new BlobSweeper({ redis: this.deps.redis });
    this.deps.eventSourcing.register(
      createBlobMaintenancePipeline({
        cleanup: {
          sweep: () => blobSweeper.sweep(),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    // Langy credential maintenance, on the same footing. The reaper existed and
    // was routed for cron, but the chart ships no CronJobs — so until now the
    // backstop for keys orphaned by a SIGKILLed manager had no caller at all.
    this.deps.eventSourcing.register(
      createLangyMaintenancePipeline({
        sessionKeyReap: {
          reap: () =>
            reapExpiredLangySessionApiKeys({ prisma: this.deps.prisma }),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    const automationCommands = mapCommands(automationPipeline.commands);
    const evalPipeline = this.registerEvaluationPipeline({
      automations: {
        triggerMatchHandler: createEvaluationAlertTriggerMatchHandler({
          triggers: this.deps.triggers,
          traceSummaryStore,
          recordTriggerMatch: {
            send: automationCommands.recordTriggerMatch,
          },
        }),
        graphActivityHandler,
      },
    });
    // Registered BEFORE the trace pipeline: its coding-agent span-facts
    // dispatch subscriber is built here, out of the pipeline, and so closes
    // over this pipeline's contribution command eagerly. Metric and log no
    // longer care — they bind their dispatch through the command bus, which
    // resolves at send time (ADR-077 §5).
    const codingAgentPipeline = this.registerCodingAgentPipeline();
    const codingAgentCommands = mapCommands(codingAgentPipeline.commands);
    const metricPipeline = this.registerMetricPipeline();
    const logPipeline = this.registerLogPipeline();
    const { pipeline: tracePipeline } = this.registerTracePipeline({
      evalPipeline,
      traceSummaryStore,
      automations: {
        triggerMatchHandler: createTraceAlertTriggerMatchHandler({
          triggers: this.deps.triggers,
          recordTriggerMatch: {
            send: automationCommands.recordTriggerMatch,
          },
        }),
        graphActivityHandler,
      },
      codingAgentSubscribers: [
        createCodingAgentSpanFactsDispatchSubscriber({
          contributeSpanFacts: codingAgentCommands.contributeSpanFacts,
          getNormalizedSpanById: (params) =>
            this.deps.traces.spans.getNormalizedSpanById(params),
        }),
      ],
    });
    const { pipeline: simulationPipeline, scenarioExecutionHandle } =
      this.registerSimulationPipeline({
        traceSummaryStore,
      });

    const experimentRunPipeline = this.registerExperimentRunPipeline();
    const { pipeline: langyConversationPipeline } =
      this.registerLangyConversationPipeline();
    const { pipeline: topicClusteringPipeline } =
      this.registerTopicClusteringPipeline();
    const enterprisePipelines = registerEnterprisePipelineSet({
      ...this.deps.enterprisePipelines,
      eventSourcing: this.deps.eventSourcing,
    });
    const billingPipeline = this.registerBillingReportingPipeline();

    // ADR-077 §5 — every command port bound during registration must resolve
    // now that registration is complete. Lazy resolution is what deletes the
    // ordering constraint; this is what stops it deferring a missing command
    // to the first production dispatch.
    this.deps.eventSourcing.commandBus.assertPortsResolvable();

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      metrics: mapCommands(metricPipeline.commands),
      logs: mapCommands(logPipeline.commands),
      codingAgents: mapCommands(codingAgentPipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      langy: mapCommands(langyConversationPipeline.commands),
      topicClustering: mapCommands(topicClusteringPipeline.commands),
      ...enterprisePipelines.commands,
      billing: mapCommands(billingPipeline.commands),
      automations: automationCommands,
      /**
       * Late-bind the execution pool that the `scenarioExecution` process
       * outbox dispatches into (ADR-073). Worker startup calls `setPool` once
       * the pool exists; until then a dispatch throws
       * `ScenarioExecutorUnavailableError` and the outbox row stays pending.
       */
      scenarioExecutionHandle,
    };
  }

  /**
   * ADR-051: topic clustering scheduling as a builder-mounted process
   * manager (ADR-052) — the pipeline declares the whole topology (events,
   * projection, commands, process manager, outbox tuning); the shared
   * ProcessRuntime owns the manager, outbox and wake workers. The registry
   * only injects the run port and the command bus; the pipeline binds its own
   * outcome commands through the bus, so nothing here is resolved after
   * `.build()` (ADR-077 §5).
   */
  private registerTopicClusteringPipeline() {
    const pipeline = this.deps.eventSourcing.register(
      createTopicClusteringProcessingPipeline({
        topicClusteringRunStatusStore:
          this.deps.repositories.topicClusteringRunStatus,
        topicClusteringRunHistoryStore:
          this.deps.repositories.topicClusteringRunHistory,
        topicModelStore: this.deps.repositories.topicModel,
        runPort: this.deps.topicClustering.runPort,
        commands: this.deps.eventSourcing.commandBus,
      }),
    );

    const commands = mapCommands(pipeline.commands);
    // Level-triggered bootstrap: the projectMetadata reactor asks on every
    // real ingest, and this claim keeps that to one commit per project per
    // window. See createRateLimitedBootstrap for why re-asking is safe.
    this.bootstrapTopicClustering.resolve(
      createRateLimitedBootstrap({
        redis: this.deps.redis,
        bootstrap: (projectId) =>
          commands.requestClustering({
            tenantId: projectId,
            occurredAt: Date.now(),
            trigger: "bootstrap",
          }),
      }),
    );

    return { pipeline };
  }

  /** Langy writes its low-latency operational projections directly to Postgres. */
  private registerLangyConversationPipeline() {
    const pipeline = this.deps.eventSourcing.register(
      createLangyConversationProcessingPipeline({
        langyConversationProjectionStore:
          this.deps.repositories.langyConversationState,
        langyConversationTurnProjectionStore:
          this.deps.repositories.langyConversationTurnState,
        langyMessageProjectionStore: this.deps.repositories.langyMessageStorage,
        langyAnalyticsEventProjectionStore:
          this.deps.repositories.langyAnalyticsEventStorage,
        langyTurnAdmissionRepository: this.deps.repositories.langyTurnAdmission,
        tokenBuffer: this.deps.langy.buffer,
        handoffStore: this.deps.langy.handoffStore,
        worker: this.deps.langy.worker,
        titleGenerator: this.deps.langy.titleGenerator,
        broadcast: this.deps.broadcast,
        mintSessionKey: ({ userId, projectId, organizationId }) =>
          mintLangySessionApiKeyForUser({
            prisma: this.deps.prisma,
            userId,
            projectId,
            organizationId,
          }),
        revokeSessionKey: ({ apiKeyId, projectId }) =>
          revokeLangySessionApiKey({
            prisma: this.deps.prisma,
            apiKeyId,
            projectId,
          }).then(() => undefined),
        commands: this.deps.eventSourcing.commandBus,
      }),
    );

    // The outbox worker, dispatcher and process service are owned by
    // ProcessRuntime now that the process is declared on the pipeline; the
    // registry no longer constructs or starts them. The two self-dispatch
    // `Deferred`s are gone too: the pipeline binds `failAgentResponse` and
    // `generateConversationTitle` through the command bus (ADR-077 §5).
    return { pipeline };
  }

  private registerMetricPipeline() {
    return this.deps.eventSourcing.register(
      createMetricProcessingPipeline({
        metricDataPointRepository:
          this.deps.repositories.metricDataPointStorage,
        metricCommandShardCount: resolveMetricCommandShardCount(
          process.env.METRIC_PROCESSING_SHARDS,
        ),
        commands: this.deps.eventSourcing.commandBus,
      }),
    );
  }

  /**
   * ADR-056: the session-aggregate pipeline. Contribution commands are its
   * write surface; the session fold and the (trace → session) map are its
   * projections. The dispatch subscribers that feed it mount on the source
   * pipelines; metric and log reach it through the command bus, and trace
   * still closes over `contributeSpanFacts` eagerly, so this stays ahead of
   * trace until trace-processing migrates too (ADR-077 step 7).
   */
  private registerCodingAgentPipeline() {
    return this.deps.eventSourcing.register(
      createCodingAgentProcessingPipeline({
        codingAgentSessionRepository: this.deps.repositories.codingAgentSession,
        codingAgentTraceSessionRepository:
          this.deps.repositories.codingAgentTraceSession,
        sessionMetricSeriesRepository:
          this.deps.repositories.sessionMetricSeries,
        foldCacheClient: this.deps.foldCacheClient,
      }),
    );
  }

  private registerLogPipeline() {
    return this.deps.eventSourcing.register(
      createLogProcessingPipeline({
        canonicalLogRecordRepository:
          this.deps.repositories.canonicalLogStorage,
        logCommandShardCount: resolveCanonicalLogCommandShardCount(
          process.env.LOG_PROCESSING_SHARDS,
        ),
        commands: this.deps.eventSourcing.commandBus,
      }),
    );
  }

  private registerEvaluationPipeline({
    automations,
  }: {
    automations: EvaluationProcessingPipelineDeps["automations"];
  }) {
    const executeEvaluationCommand = new ExecuteEvaluationCommand({
      monitors: this.deps.monitors,
      spanStorage: this.deps.traces.spans,
      traceEvents: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
      costRecorder: this.deps.costRecorder,
      azureSafetyEnvResolver: getAzureSafetyEnvFromProject,
      // ADR-040: offload oversized evaluator inputs to durable object storage
      // before the event is built. ON by default (this bounds the fat-payload
      // class behind the 2026-07-10 outage); the SYSTEM flag
      // ops_evaluation_payload_offload_disabled is the operator kill switch.
      // A flag-store error keeps the DEFAULT (offload runs): the kill switch
      // failing to read must not silently drop the protection. Storage errors
      // are handled INSIDE offloadInputsIfOversized, which degrades to a
      // bounded preview-only marker so the event stays lean even when S3 is
      // down. The catch below is the wiring-level fail-open for unexpected
      // errors only (service construction, serialization); there the inputs
      // stay inline and the unconditional repository belt-and-braces cap
      // keeps the ClickHouse row merge-safe.
      offloadInputs: async ({ projectId, evaluationId, inputs }) => {
        try {
          let disabled = false;
          try {
            disabled = await featureFlagService.isEnabled(
              "ops_evaluation_payload_offload_disabled",
              { distinctId: "evaluation-inputs-offload", defaultValue: false },
            );
          } catch {
            // Unreadable kill switch: stay on the default (offload enabled).
          }
          if (disabled) return inputs;
          const { inputs: maybeOffloaded } = await offloadInputsIfOversized({
            inputs,
            projectId,
            evaluationId,
            storedObjects: createStoredObjectsService({ projectId }),
          });
          return maybeOffloaded;
        } catch (error) {
          createLogger("langwatch:evaluations:inputs-offload-fail-open").warn(
            {
              projectId,
              evaluationId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Evaluation inputs offload gate failed; keeping inputs inline (fail-open)",
          );
          return inputs;
        }
      },
    });

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        // Redis cache is the eval slim fold's warm read path; a miss now falls
        // through to the store's own ClickHouse read-back (ADR-066, migration
        // 00056) rather than re-folding the event log. Same wiring as
        // trace_analytics.
        evaluationAnalyticsStore: new CachedFoldStore<EvaluationAnalyticsData>(
          new EvaluationAnalyticsStore(
            this.deps.repositories.evaluationAnalytics,
          ),
          this.deps.foldCacheClient,
          { keyPrefix: "evaluation_analytics" },
        ),
        evaluationAnalyticsRollupAppendStore:
          new EvaluationAnalyticsRollupAppendStore(
            this.deps.repositories.evaluationAnalyticsRollup,
          ),
        executeEvaluationCommand,
        automations,
      }),
    );
  }

  private registerTracePipeline({
    evalPipeline,
    traceSummaryStore,
    automations,
    codingAgentSubscribers,
  }: {
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    automations: TraceProcessingPipelineDeps["automations"];
    codingAgentSubscribers: TraceProcessingPipelineDeps["subscribers"];
  }) {
    const evalCommands = mapCommands(evalPipeline.commands);

    // Deferred dispatchers — resolved after pipeline registration.
    const resolveOrigin = new Deferred<
      CommandDispatcher<ResolveOriginCommandData>
    >("resolveOrigin");
    const scheduleDeferred = new Deferred<
      (payload: DeferredOriginPayload) => Promise<void>
    >("scheduleDeferred");

    const originGateReactor = createOriginGateReactor({
      scheduleDeferred: scheduleDeferred.fn,
    });

    const evaluationTriggerReactor = createEvaluationTriggerReactor({
      monitors: this.deps.monitors,
      evaluation: evalCommands.executeEvaluation,
    });

    const customEvaluationSyncReactor = createCustomEvaluationSyncReactor({
      reportEvaluation: evalCommands.reportEvaluation,
    });

    const traceUpdateBroadcastReactor = createTraceUpdateBroadcastReactor({
      broadcast: this.deps.broadcast,
      hasRedis: !!this.deps.eventSourcing.redisConnection,
    });

    const spanStorageBroadcastReactor = createSpanStorageBroadcastReactor({
      broadcast: this.deps.broadcast,
      hasRedis: !!this.deps.eventSourcing.redisConnection,
    });

    const projectMetadataReactor = createProjectMetadataReactor({
      projects: this.deps.projects,
      bootstrapTopicClustering: (projectId) =>
        this.bootstrapTopicClustering.fn(projectId),
    });

    // Cross-pipeline dispatch (ADR-077 §5): trace → simulation. The port binds
    // now and resolves on first dispatch, so the simulation pipeline
    // registering after this one carries no meaning.
    const simulationMetricsSyncReactor = createSimulationMetricsSyncReactor({
      computeRunMetrics: this.deps.eventSourcing.commandBus.port(
        ComputeRunMetricsCommand,
      ),
    });

    // ADR-075 Class C splits this one. The debit rows are derived state and
    // become a projection, so a replay rebuilds spend the gateway lost. The
    // `lastUsedAt` touch is a best-effort side effect on Prisma, not derived
    // state, so it becomes a subscriber.
    const gatewayBudgetDebitsProjection = this.deps.gatewayBudgetSync
      ? createGatewayBudgetDebitsProjection(this.deps.gatewayBudgetSync)
      : undefined;

    const virtualKeyLastUsedSubscriber = this.deps.gatewayBudgetSync
      ? createVirtualKeyLastUsedSubscriber({
          prisma: this.deps.gatewayBudgetSync.prisma,
        })
      : undefined;

    // ADR-075 Class C: both governance streams are projections now, so replay
    // rebuilds them. They were reactors, which replay never runs — the audit
    // trail could not be reconstructed from the log it claims to derive from.
    const governanceKpisProjection = this.deps.governanceKpisSync
      ? createGovernanceKpisProjection(this.deps.governanceKpisSync)
      : undefined;

    const governanceOcsfEventsProjection = this.deps.governanceOcsfEventsSync
      ? createGovernanceOcsfEventsProjection(this.deps.governanceOcsfEventsSync)
      : undefined;

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        traceAnalyticsRollupAppendStore: new TraceAnalyticsRollupAppendStore(
          this.deps.repositories.traceAnalyticsRollup,
        ),
        // Redis cache is the slim fold's warm read path; a miss now falls
        // through to the store's own ClickHouse read-back (ADR-066, migration
        // 00056) rather than re-folding the event log. The wrapper still earns
        // its keep — it keeps the steady state off ClickHouse entirely.
        traceAnalyticsStore: new CachedFoldStore<TraceAnalyticsData>(
          new TraceAnalyticsStore(this.deps.repositories.traceAnalytics),
          this.deps.foldCacheClient,
          { keyPrefix: "trace_analytics" },
        ),
        traceSummaryStore,
        originGateReactor,
        evaluationTriggerReactor,
        automations,
        customEvaluationSyncReactor,
        traceUpdateBroadcastReactor,
        projectMetadataReactor,
        simulationMetricsSyncReactor,
        spanStorageBroadcastReactor,
        gatewayBudgetDebitsProjection,
        virtualKeyLastUsedSubscriber,
        // ADR-022: Wire BlobStore so RecordSpanCommand can reconstitute
        // oversized commands and best-effort delete the transient S3 spool.
        blobStore: this.deps.blobStore,
        // Span-command sharding fan-out (env TRACE_SPAN_PROCESSING_SHARDS,
        // default 1 = disabled). Lets a hot trace's recordSpan commands drain in
        // parallel across `traceId:<shard>` GroupQueue groups; fold stays per-trace.
        spanCommandShardCount: resolveSpanCommandShardCount(
          process.env.TRACE_SPAN_PROCESSING_SHARDS,
        ),
        governanceKpisProjection,
        governanceOcsfEventsProjection,
        subscribers: codingAgentSubscribers,
      }),
    );

    // Resolve self-referencing commands now that the pipeline is registered
    const traceCommands = mapCommands(tracePipeline.commands);
    resolveOrigin.resolve(traceCommands.resolveOrigin);

    // Wire the deferred origin resolution queue (BullMQ-backed, survives process restart).
    // After 5 min, dispatches resolveOrigin command → OriginResolvedEvent → fold → reactor.
    const deferredOriginHandler = createDeferredOriginHandler(resolveOrigin.fn);
    const deferredOriginQueue =
      tracePipeline.service.registerJob<DeferredOriginPayload>({
        name: "deferredOriginResolution",
        process: deferredOriginHandler,
        delay: DEFERRED_CHECK_DELAY_MS,
        deduplication: {
          makeId: makeDeferredJobId,
          ttlMs: DEFERRED_CHECK_DELAY_MS + 60_000, // 6 min — covers the 5-min delay + buffer
          extend: false, // Don't reset the 5-min timer on new spans
          replace: false, // Don't update payload (same trace, same data)
        },
        groupKeyFn: (p) => p.traceId, // Per-trace parallelism (framework prepends tenantId)
        spanAttributes: (payload) => ({
          "deferred.tenant_id": payload.tenantId,
          "deferred.trace_id": payload.traceId,
        }),
      });

    if (deferredOriginQueue) {
      scheduleDeferred.resolve((payload) => deferredOriginQueue.send(payload));
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout (best-effort)
      scheduleDeferred.resolve(
        createInMemoryDeferredFallback({
          makeId: makeDeferredJobId,
          delayMs: DEFERRED_CHECK_DELAY_MS,
          process: deferredOriginHandler,
          logContext: (p) => ({ tenantId: p.tenantId, traceId: p.traceId }),
          errorMessage: "Deferred origin resolution failed",
        }),
      );
    }

    // ADR-032 D5: register the standalone `datasetNormalize` GroupQueue job
    // (pure Postgres + S3, no fold/reactor). Per-group concurrency is inherent
    // and the group key is the datasetId (framework prepends tenantId=projectId)
    // → exactly one normalize in flight per dataset. The enqueue side is wired
    // into the dataset domain via `registerDatasetNormalizeEnqueue`; when the
    // global queue is unavailable the dataset module inline-runs the handler.
    const datasetNormalizeHandler = createDatasetNormalizeHandler({
      repository: new DatasetRepository(this.deps.prisma),
      getStorage: getDatasetStorage,
    });
    const datasetNormalizeQueue =
      tracePipeline.service.registerJob<DatasetNormalizePayload>({
        name: "datasetNormalize",
        process: datasetNormalizeHandler,
        // The per-dataset group key already serializes to concurrency-1, so no
        // deduplication block is needed; the 200ms debounce default is
        // surprising and could swallow a fast retry (m1).
        groupKeyFn: (p) => p.datasetId,
      });

    if (datasetNormalizeQueue) {
      registerDatasetNormalizeEnqueue((payload) =>
        datasetNormalizeQueue.send(payload),
      );
    }
    // No else: when the global queue is absent the dataset module falls back to
    // running the handler inline at enqueue time (dev/test without a worker).

    return {
      pipeline: tracePipeline,
      traceSummaryStore,
    };
  }

  private registerSimulationPipeline({
    traceSummaryStore,
  }: {
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  }) {
    // The durable tier, held separately: the cached wrapper below is what the
    // pipeline reads for display, but the at-most-once dispatch guard reads
    // THIS one. A fold-cache hit carries no cross-process freshness promise
    // (ADR-066: it is a dumb read/write cache), and a stale `QUEUED` served to
    // `readRunStatus` is exactly the answer that lets a redelivery spawn a
    // second run.
    const durableSimulationRunStore =
      new RepositoryFoldStore<SimulationRunStateData>(
        this.deps.repositories.simulationRunState,
        SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      );
    const simulationRunStore = new CachedFoldStore<SimulationRunStateData>(
      durableSimulationRunStore,
      this.deps.foldCacheClient,
      { keyPrefix: "simulation_runs" },
    );

    // ADR-073 step 2: dispatch is an outbox intent, not a reactor. The handle
    // keeps `setPool` so worker startup binds its pool the same way; what
    // changed is that a dispatch with nothing wired to run it now throws and is
    // retried, where the reactor logged and dropped it.
    const scenarioExecutionHandle = createScenarioExecutionDispatcher({
      run: ({ job, pool }) => executeScenarioRun(job, pool),
    });

    // The one late binding the command bus cannot absorb: the retry lane is a
    // *job* on this pipeline's runtime service, registered below because it
    // does not exist until `register()` has returned. `Deferred` stays for its
    // named error — a bare thunk would report a missing lane as `undefined is
    // not a function`.
    const scheduleRetry = new Deferred<
      (payload: ComputeRunMetricsCommandData) => Promise<void>
    >("scheduleRetry");

    const traceReadDerivation = new TraceReadDerivationService(
      this.deps.traces.spans,
    );

    const simulationPipeline = this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        traceSummaryStore,
        broadcast: this.deps.broadcast,
        hasRedis: !!this.deps.eventSourcing.redisConnection,
        cancellationPublisher: this.deps.eventSourcing.redisConnection ?? null,
        deriveScenarioRoleMetrics: (params) =>
          traceReadDerivation.deriveScenarioRoleMetrics(params),
        scheduleComputeRunMetricsRetry: scheduleRetry.fn,
        commands: this.deps.eventSourcing.commandBus,
        // ADR-073: the `scenarioExecution` process writes the terminal state
        // for a run whose worker died. The failure handler resolves the app
        // lazily because it dispatches a command on the very pipeline being
        // registered here.
        scenarioExecutionDispatch: {
          executeRun: (job) => scenarioExecutionHandle.execute(job),
          // ADR-073 step 2: at-most-once is a property of the WORK, not of the
          // attempt. `attempts` is bumped only by markDispatched/markFailed —
          // leasing does not touch it — so a worker hard-killed mid-child is
          // re-leased at attempt 1 and `maxAttempts` cannot stop a re-run.
          // Reading the run's own stored status back does, and survives
          // redelivery, lease lapse and restart alike — provided the read is
          // the durable one. The fold cache is deliberately bypassed here.
          readRunStatus: async ({ projectId, scenarioRunId }) =>
            (
              await durableSimulationRunStore.get(scenarioRunId, {
                aggregateId: scenarioRunId,
                tenantId: createTenantId(projectId),
              })
            )?.Status ?? null,
          emitFailure: (params) =>
            ScenarioFailureHandler.create().ensureFailureEventsEmitted(params),
          lookupScenario: ({ projectId, scenarioId }) =>
            ScenarioService.create(this.deps.prisma).getById({
              projectId,
              id: scenarioId,
            }),
        },
      }),
    );

    const simCommands = mapCommands(simulationPipeline.commands);

    // Resolve deferred retry job
    const retryJobId = (payload: ComputeRunMetricsCommandData) =>
      `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`;

    const retryQueue =
      simulationPipeline.service.registerJob<ComputeRunMetricsCommandData>({
        name: "deferredComputeRunMetrics",
        process: async (payload) => {
          await simCommands.computeRunMetrics(payload);
        },
        delay: COMPUTE_METRICS_RETRY_DELAY_MS,
        deduplication: {
          makeId: retryJobId,
          extend: false,
          replace: true,
        },
        spanAttributes: (payload) => ({
          "deferred.tenant_id": payload.tenantId,
          "deferred.scenario_run_id": payload.scenarioRunId,
          "deferred.trace_id": payload.traceId,
          "deferred.retry_count": payload.retryCount,
        }),
      });

    if (retryQueue) {
      scheduleRetry.resolve((payload) => retryQueue.send(payload));
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout
      scheduleRetry.resolve(
        createInMemoryDeferredFallback({
          delayMs: COMPUTE_METRICS_RETRY_DELAY_MS,
          process: (payload) => simCommands.computeRunMetrics(payload),
          logContext: (p) => ({
            tenantId: p.tenantId,
            scenarioRunId: p.scenarioRunId,
            traceId: p.traceId,
          }),
          errorMessage: "Deferred compute metrics retry failed",
        }),
      );
    }

    return { pipeline: simulationPipeline, scenarioExecutionHandle };
  }

  private registerBillingReportingPipeline() {
    return this.deps.eventSourcing.register(
      createBillingReportingPipeline({
        organizations: this.deps.organizations,
        billingCheckpoints: this.deps.billingCheckpoints,
        getUsageReportingService: () => this.deps.usageReportingService,
        queryBillableEventsTotal,
        commands: this.deps.eventSourcing.commandBus,
      }),
    );
  }

  private registerExperimentRunPipeline() {
    return this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateRepository: this.deps.repositories.experimentRunState,
        experimentRunItemAppendStore:
          this.deps.repositories.experimentRunItemStorage,
        foldCacheClient: this.deps.foldCacheClient,
        commands: this.deps.eventSourcing.commandBus,
        // ADR-073: the reaper's terminal write is this pipeline's own command
        // and binds inside it. These are the two effects it cannot own — stop
        // work that may still be running, and mark the cached progress record.
        //
        // Stopping FIRST is deliberate: result dispatch is `.catch()`-swallowed
        // in the orchestrator, so a ClickHouse outage looks exactly like process
        // death. If the deadline fired wrongly and work is still going, this
        // makes the terminal state true rather than merely recorded — and stops
        // the run spending against a run the platform has already ended.
        experimentRunExecutionEffects: {
          signalStop: ({ runId }) => abortManager.requestAbort(runId),
          markRunFailed: ({ runId, code }) =>
            runStateManager.failRun(runId, { code }),
        },
      }),
    );
  }
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;

// ============================================================================
// Introspection — derived from the live EventSourcing runtime
// ============================================================================

import { getApp } from "../app-layer/app";
// StaticPipelineDefinition is already imported at the top of the file.

export interface ProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map";
}

export interface EventSubscriberMetadata {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  /** The event types this subscriber reacts to — its transition triggers. */
  eventTypes: readonly string[];
}

export interface DejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

function getDefinitions(): ReadonlyArray<
  StaticPipelineDefinition<any, any, any>
> {
  return getApp().eventSourcing?.definitions ?? [];
}

export function getProjectionMetadata(): ProjectionMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    const folds = Array.from(def.foldProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        pauseKey: `${pipelineName}/projection/${definition.name}`,
        kind: "fold" as const,
      }),
    );
    const maps = Array.from(def.mapProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // Maps run as `__jobType=handler` in the GroupQueue, so the pause-set
        // entry must use the `handler` segment to match the dispatcher's Lua check.
        pauseKey: `${pipelineName}/handler/${definition.name}`,
        kind: "map" as const,
      }),
    );
    return [...folds, ...maps];
  });
}

/**
 * Event subscribers registered on each pipeline — live consumers of committed
 * events that carry no projection state. This is the DejaView-facing view of
 * the `.withEventSubscriber` / `.withSubscriber({ events })` seam; the
 * process-manager runtime's generated `pm:<name>` subscribers are internal
 * plumbing and are not part of the static definition, so they are not listed.
 */
export function getEventSubscriberMetadata(): EventSubscriberMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.eventSubscribers.values()).map((definition) => ({
      subscriberName: definition.name,
      pipelineName,
      aggregateType,
      eventTypes: definition.eventTypes,
    }));
  });
}

export interface ProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands, dispatched
   * through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

/**
 * The process-manager state machines mounted across the pipelines.
 *
 * The machine itself is implicit in each manager's `evolve` — there is no
 * declared state set or transition table — so what is introspectable is the
 * definition surface: which event types trigger it, which intents it can emit,
 * and how it wakes. The per-aggregate *position* in the machine lives in the
 * persisted instance, read separately by ref.
 */
export function getProcessManagerMetadata(): ProcessManagerMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.processManagers.values()).map(({ config }) => ({
      processName: config.name,
      pipelineName,
      aggregateType,
      eventTypes: config.eventTypes,
      intentTypes: Object.keys(config.intents ?? {}),
      scheduled: Boolean(config.schedule),
      everyMs: config.schedule?.everyMs ?? null,
      hasWake: Boolean(config.onWake),
    }));
  });
}

/**
 * One descriptor per ES kill-switch key that the registered pipelines
 * will generate at runtime. Used by the Ops Feature Flags page to list
 * every togglable kill switch, even ones that have no postgres row yet.
 *
 * Names follow `es-<aggregate>-<componentType>-<componentName>-killswitch`
 * (see src/server/event-sourcing/utils/killSwitch.ts).
 */
export interface KillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: KillSwitchComponentType;
  componentName: string;
  pipelineName: string;
}

export function getKillSwitchDescriptors(): KillSwitchDescriptor[] {
  const out: KillSwitchDescriptor[] = [];
  for (const def of getDefinitions()) {
    const { name: pipelineName, aggregateType } = def.metadata;
    for (const { definition } of def.foldProjections.values()) {
      out.push({
        key: `es-${aggregateType}-projection-${definition.name}-killswitch`,
        aggregateType,
        componentType: "projection",
        componentName: definition.name,
        pipelineName,
      });
    }
    for (const { definition } of def.mapProjections.values()) {
      out.push({
        key: `es-${aggregateType}-mapProjection-${definition.name}-killswitch`,
        aggregateType,
        componentType: "mapProjection",
        componentName: definition.name,
        pipelineName,
      });
    }
    for (const cmd of def.commands) {
      out.push({
        key: `es-${aggregateType}-command-${cmd.name}-killswitch`,
        aggregateType,
        componentType: "command",
        componentName: cmd.name,
        pipelineName,
      });
    }
    // Subscribers belong here MORE than the others do, not less: the enqueue
    // seam decides relevance and DISCARDS what it judges irrelevant, and
    // subscriber fan-out is never replayed (ADR-069), so a bad filter loses
    // those events for good. `ops.setFeatureFlag` rejects any key that is
    // neither a registry entry nor a live descriptor, so a switch missing from
    // this list is not merely unlisted — it is unsettable, leaving a revert as
    // the only way to stop the seam it guards.
    //
    // A subscriber may override its key via `options.killSwitch.customKey`;
    // emit the key the router will actually read, or the page would offer one
    // nothing consults.
    for (const definition of def.eventSubscribers.values()) {
      out.push({
        // Generated, never re-spelled: the comment above is the reason. A
        // hand-built key that drifts from `generateKillSwitchKey` is not a
        // cosmetic mismatch — `ops.setFeatureFlag` refuses a key that is
        // neither a registry entry nor a live descriptor, so the switch
        // becomes unsettable.
        key:
          definition.options?.killSwitch?.customKey ??
          generateKillSwitchKey(aggregateType, "subscriber", definition.name),
        aggregateType,
        componentType: "subscriber",
        componentName: definition.name,
        pipelineName,
      });
    }
  }
  return out;
}

export function getDejaViewProjections(): DejaViewProjection[] {
  return getDefinitions().flatMap((def) =>
    Array.from(def.foldProjections.values()).map(({ definition: d }) => ({
      projectionName: d.name,
      eventTypes: d.eventTypes,
      init: () => d.init(),
      apply: (state: unknown, event: { type: string }) =>
        d.apply(state, event as any),
    })),
  );
}
