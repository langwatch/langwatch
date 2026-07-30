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
import { createTraceAlertTriggerMatchSubscriber } from "@ee/governance/subscribers/traceAlertTriggerMatch.subscriber";
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
import { PrismaBillingReportingCandidatesService } from "../app-layer/billing/billingReportingCandidates.service";
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
import type { AutomationDispatchPorts } from "../event-sourcing.old/pipelines/automations/automationDispatch.adapter";
import { createGraphTriggerActivityHandler } from "../event-sourcing.old/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import type { TopicClusteringRunPort } from "../event-sourcing.old/pipelines/topic-clustering-processing/process-manager";
import { createScenarioExecutionDispatcher } from "../scenarios/execution/execution-dispatcher";
import { executeScenarioRun } from "../scenarios/scenario.processor";
import { ScenarioService } from "../scenarios/scenario.service";
import { ScenarioFailureHandler } from "../scenarios/scenario-failure-handler";
import { Deferred } from "./deferred";
import { createTenantId } from "./domain/tenantId";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import { createAutomationsPipeline } from "./pipelines/automations/pipeline";
import { createBillingReportingPipeline } from "./pipelines/billing-reporting/pipeline";
import { createBlobMaintenancePipeline } from "./pipelines/blob-maintenance/pipeline";
import { createCodingAgentProcessingPipeline } from "./pipelines/coding-agent-processing/pipeline";
import {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./pipelines/evaluation-processing/pipeline";
import { evaluationAnalyticsFoldStore } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.store";
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
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
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
import type { EvaluationTriggerDispatchDeps } from "./pipelines/trace-processing/process-manager/evaluationTriggerIntentHandlers";
import type { DerivedTraceEvent } from "./pipelines/trace-processing/projections/services/trace-events.derivation";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import type { TraceAnalyticsData } from "./pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "./pipelines/trace-processing/projections/traceAnalytics.store";
import { TraceAnalyticsRollupAppendStore } from "./pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import type { ProcessStore } from "./process-manager";
import { CachedFoldStore } from "./projections/cachedFoldStore";
import type { FoldCacheClient } from "./projections/foldCache/foldCacheClient";
import type { FoldProjectionStore } from "./projections/foldProjection.types";
import type { AppendStore } from "./projections/mapProjection.types";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import type { StateProjectionStore } from "./projections/stateProjection.types";
import { BlobSweeper } from "./queues/groupQueue/blobSweeper";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

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
  /** ADR-105: the session-aggregate row + the (trace → session) map. */
  codingAgentSession: CodingAgentSessionRepository;
  codingAgentTraceSession: CodingAgentTraceSessionRepository;
  /** ADR-105: converged per-series metric totals per session. */
  sessionMetricSeries: SessionMetricSeriesRepository;
  metricDataPointStorage: MetricDataPointRepository;
  /** ADR-099: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-099: slim per-trace analytics repository (dual-tap). */
  traceAnalytics: TraceAnalyticsRepository;
  /** ADR-099: per-evaluation rollup repository. */
  evaluationAnalyticsRollup: EvaluationAnalyticsRollupRepository;
  /** ADR-099: slim per-evaluation analytics repository. */
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
  /** Per-project topic clustering run status (ADR-098, Postgres). */
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
   * ADR-102: the cache tier fold projections read and write through, already
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
    /** Runs one clustering page (the ADR-098 effect's domain function). */
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
  /**
   * SaaS build. The per-event billing poke is mounted on four pipelines and is
   * `disabled` everywhere this is false — usage reporting exists only in SaaS,
   * and a self-hosted deployment must not carry a per-span subscriber whose
   * command can never land.
   */
  isSaas: boolean;
  usageReportingService?: UsageReportingService;
  gatewayBudgetSync?: GatewayBudgetDebitsProjectionDeps;
  /**
   * ADR-099: BlobStore for RecordSpanCommand spool reconstitution.
   * When provided, the trace-processing pipeline wires it into RecordSpanCommand
   * so oversized commands (> 256 KB) are fetched from S3 and the spool is
   * best-effort DELETEd after event_log INSERT succeeds.
   */
  blobStore?: BlobStore;
  governanceKpisSync?: GovernanceKpisProjectionDeps;
  governanceOcsfEventsSync?: GovernanceOcsfEventsProjectionDeps;
}

/**
 * Composition root for all event-sourcing pipelines.
 *
 * Creates store adapters and the handful of artifacts a pipeline cannot build
 * for itself (ADR-102 — everything else is constructed inside the
 * pipeline), then registers all pipelines with the EventSourcing runtime.
 * Pipelines receive store interfaces, ports and pre-built artifacts — never raw
 * deps like prisma or ClickHouse clients.
 */
export class PipelineRegistry {
  constructor(private readonly deps: PipelineRegistryDeps) {}

  /**
   * ADR-098: the trace pipeline's `topicClusteringBootstrap` subscriber
   * re-asserts a project's clustering schedule on every real ingest, but the
   * topic clustering pipeline (whose command it dispatches) registers later —
   * late-bound like the other cross-pipeline dispatchers.
   */
  private readonly bootstrapTopicClustering = new Deferred<
    (projectId: string) => Promise<void>
  >("bootstrapTopicClustering");

  registerAll() {
    // Event-sourced Customer.io nurture sync does not exist. ADR-098 offered
    // the choice of finishing the counting work or deleting the three unwired
    // trace/evaluation/simulation reactors, and they were deleted — nothing
    // replaced them, and the per-event counts they wanted were never written.
    // Nurture that does run reaches Customer.io through the direct hooks in
    // `ee/billing/nurturing/hooks/`, which owe this registry nothing. Building
    // the event-sourced half is a new feature; should anyone start it, each
    // pipeline mounts its own subscriber via `.withEventSubscriber`
    // (ADR-102) rather than this file constructing handlers.

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
    // The committed trace summary, read by identity. The one contract for all
    // three readers of it — the trace-alert subscriber, the evaluation-alert
    // subscriber and the evaluation trigger's dispatch — so they cannot
    // disagree about the tier (the cached fold store, not ClickHouse) and none
    // of them holds a store it could write through.
    const readTraceSummary = ({
      tenantId,
      traceId,
      occurredAtMs,
    }: {
      tenantId: string;
      traceId: string;
      occurredAtMs?: number;
    }) =>
      traceSummaryStore.get(traceId, {
        aggregateId: traceId,
        tenantId: createTenantId(tenantId),
        occurredAtMs,
      });

    const evalPipeline = this.registerEvaluationPipeline({
      automations: {
        triggers: this.deps.triggers,
        readTraceSummary,
        graphActivityHandler,
      },
    });
    const codingAgentPipeline = this.registerCodingAgentPipeline();
    const metricPipeline = this.registerMetricPipeline();
    const logPipeline = this.registerLogPipeline();
    const { pipeline: tracePipeline } = this.registerTracePipeline({
      evalPipeline,
      traceSummaryStore,
      readTraceSummary,
      automations: {
        triggerMatchSubscriber: createTraceAlertTriggerMatchSubscriber({
          triggers: this.deps.triggers,
          readTraceSummary,
          recordTriggerMatch: {
            send: automationCommands.recordTriggerMatch,
          },
        }),
        graphActivityHandler,
      },
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

    // ADR-102 — every command port bound during registration must resolve
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
       * outbox dispatches into (ADR-103). Worker startup calls `setPool` once
       * the pool exists; until then a dispatch throws
       * `ScenarioExecutorUnavailableError` and the outbox row stays pending.
       */
      scenarioExecutionHandle,
    };
  }

  /**
   * ADR-098: topic clustering scheduling as a builder-mounted process
   * manager (ADR-098) — the pipeline declares the whole topology (events,
   * projection, commands, process manager, outbox tuning); the shared
   * ProcessRuntime owns the manager, outbox and wake workers. The registry
   * only injects the run port and the command bus; the pipeline binds its own
   * outcome commands through the bus, so nothing here is resolved after
   * `.build()` (ADR-102).
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
    // Level-triggered bootstrap: the `topicClusteringBootstrap` subscriber asks
    // on every real ingest, and this claim keeps that to one commit per project
    // per window. See createRateLimitedBootstrap for why re-asking is safe.
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
    // `generateConversationTitle` through the command bus (ADR-102).
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
   * ADR-105: the session-aggregate pipeline. Contribution commands are its
   * write surface; the session fold and the (trace → session) map are its
   * projections. The dispatch subscribers that feed it mount on the source
   * pipelines — trace, metric and log — and all three reach it through the
   * command bus, which resolves at send time (ADR-102). Nothing here closes
   * over a contribution command eagerly any more, so where this call sits
   * relative to those three registrations carries no meaning.
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
    // ADR-102: the command itself is constructed by the pipeline. What
    // is assembled here is only what it runs on — the app-layer services this
    // composition root owns, plus the two function ports below.
    const executeEvaluation: EvaluationProcessingPipelineDeps["executeEvaluation"] =
      {
        monitors: this.deps.monitors,
        spanStorage: this.deps.traces.spans,
        traceEvents: this.deps.traces.spans,
        evaluationExecution: this.deps.evaluations.execution,
        costRecorder: this.deps.costRecorder,
        azureSafetyEnvResolver: getAzureSafetyEnvFromProject,
        // ADR-096: offload oversized evaluator inputs to durable object storage
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
                {
                  distinctId: "evaluation-inputs-offload",
                  defaultValue: false,
                },
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
      };

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        // Redis cache is the eval slim fold's warm read path; a miss falls
        // through to the store's own ClickHouse read-back (ADR-099, migration
        // 00056) rather than re-folding the event log.
        //
        // `cached()` is the only shape the library offers, deliberately: the
        // cache tier is part of the storage design rather than something a
        // composition site assembles. Assembling it by hand is what let five
        // stores drift into four different read-back gates.
        evaluationAnalyticsStore: evaluationAnalyticsFoldStore.cached({
          repository: this.deps.repositories.evaluationAnalytics,
          cache: this.deps.foldCacheClient,
        }),
        evaluationAnalyticsRollupAppendStore:
          new EvaluationAnalyticsRollupAppendStore(
            this.deps.repositories.evaluationAnalyticsRollup,
          ),
        executeEvaluation,
        commands: this.deps.eventSourcing.commandBus,
        isSaas: this.deps.isSaas,
        automations,
      }),
    );
  }

  private registerTracePipeline({
    evalPipeline,
    traceSummaryStore,
    readTraceSummary,
    automations,
  }: {
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    readTraceSummary: EvaluationTriggerDispatchDeps["readTraceSummary"];
    automations: TraceProcessingPipelineDeps["automations"];
  }) {
    const evalCommands = mapCommands(evalPipeline.commands);

    // ADR-098 splits this one. The debit rows are derived state and
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

    // ADR-098: both governance streams are projections now, so replay
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
        // through to the store's own ClickHouse read-back (ADR-099, migration
        // 00056) rather than re-folding the event log. The wrapper still earns
        // its keep — it keeps the steady state off ClickHouse entirely.
        traceAnalyticsStore: new CachedFoldStore<TraceAnalyticsData>(
          new TraceAnalyticsStore(this.deps.repositories.traceAnalytics),
          this.deps.foldCacheClient,
          { keyPrefix: "trace_analytics" },
        ),
        traceSummaryStore,
        // ADR-102. Two ports resolve through this: the origin gate's own
        // `resolveOrigin` (this pipeline's command — self-dispatch needs no
        // late binding) and the billing poke's hop into billing-reporting.
        commands: this.deps.eventSourcing.commandBus,
        broadcast: this.deps.broadcast,
        hasRedis: !!this.deps.eventSourcing.redisConnection,
        projects: this.deps.projects,
        bootstrapTopicClustering: (projectId) =>
          this.bootstrapTopicClustering.fn(projectId),
        // ADR-098's claim-check for the coding-agent span-facts dispatch the
        // pipeline mounts: the canonical span, read back by identity.
        getNormalizedSpanById: (params) =>
          this.deps.traces.spans.getNormalizedSpanById(params),
        // The dispatch reads the trace back at request time rather than
        // carrying it on the intent: everything a process holds is persisted
        // verbatim into its instance row and outbox (ADR-098).
        evaluationTriggerDispatch: {
          monitors: this.deps.monitors,
          readTraceSummary,
          evaluation: evalCommands.executeEvaluation,
        },
        // ADR-098's claim-check: the intent carries the span's identity, and
        // the verdicts are read back out of the store `spanStorage` already
        // wrote them to.
        customEvaluationSyncDispatch: {
          reportEvaluation: evalCommands.reportEvaluation,
          getSpanEvents: (params) =>
            this.deps.traces.spans.getSpanEvents(params),
        },
        isSaas: this.deps.isSaas,
        automations,
        gatewayBudgetDebitsProjection,
        virtualKeyLastUsedSubscriber,
        // ADR-099: Wire BlobStore so RecordSpanCommand can reconstitute
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
      }),
    );

    // ADR-032 D5: register the standalone `datasetNormalize` GroupQueue job
    // (pure Postgres + S3, no fold/projection). Per-group concurrency is
    // inherent and the group key is the datasetId (framework prepends
    // tenantId=projectId) → exactly one normalize in flight per dataset. The
    // enqueue side is wired into the dataset domain via
    // `registerDatasetNormalizeEnqueue`; when the global queue is unavailable
    // the dataset module inline-runs the handler.
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
    // (ADR-099: it is a dumb read/write cache), and a stale `QUEUED` served to
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

    // ADR-103: dispatch is an outbox intent, not a reactor. The handle
    // keeps `setPool` so worker startup binds its pool the same way; what
    // changed is that a dispatch with nothing wired to run it now throws and is
    // retried, where the reactor logged and dropped it.
    const scenarioExecutionHandle = createScenarioExecutionDispatcher({
      run: ({ job, pool }) => executeScenarioRun(job, pool),
    });

    const traceReadDerivation = new TraceReadDerivationService(
      this.deps.traces.spans,
    );

    const simulationPipeline = this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        traceSummaryStore,
        broadcast: this.deps.broadcast,
        cancellationPublisher: this.deps.eventSourcing.redisConnection ?? null,
        deriveScenarioRoleMetrics: (params) =>
          traceReadDerivation.deriveScenarioRoleMetrics(params),
        isSaas: this.deps.isSaas,
        commands: this.deps.eventSourcing.commandBus,
        // ADR-103: the `scenarioExecution` process writes the terminal state
        // for a run whose worker died. The failure handler resolves the app
        // lazily because it dispatches a command on the very pipeline being
        // registered here.
        scenarioExecutionDispatch: {
          executeRun: (job) => scenarioExecutionHandle.execute(job),
          // ADR-103: at-most-once is a property of the WORK, not of the
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

    return { pipeline: simulationPipeline, scenarioExecutionHandle };
  }

  private registerBillingReportingPipeline() {
    // The candidate query is the one thing the sweep cannot own: it is a
    // platform-wide Postgres read, and the pipeline is handed ports rather than
    // raw deps (ADR-102). Built here, on the same footing as the other
    // scheduled sweeps below it.
    const billingReportingCandidates =
      new PrismaBillingReportingCandidatesService(this.deps.prisma);

    return this.deps.eventSourcing.register(
      createBillingReportingPipeline({
        organizations: this.deps.organizations,
        billingCheckpoints: this.deps.billingCheckpoints,
        getUsageReportingService: () => this.deps.usageReportingService,
        queryBillableEventsTotal,
        commands: this.deps.eventSourcing.commandBus,
        // Without this the pipeline reports usage exclusively off the per-event
        // poke, and the poke's own docstring promises a guarantee that would
        // not exist: an organization whose last billable event of the month is
        // its last event ever would never have that month's total reported.
        sweep: {
          listOrganizationsToReport: (params) =>
            billingReportingCandidates.listOrganizationsToReport(params),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
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
        isSaas: this.deps.isSaas,
        // ADR-103: the reaper's terminal write is this pipeline's own command
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
