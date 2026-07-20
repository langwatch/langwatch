import { createTraceAlertTriggerMatchHandler } from "@ee/governance/subscribers/traceAlertTriggerMatch.subscriber";
import {
  createGatewayBudgetSyncReactor,
  type GatewayBudgetSyncReactorDeps,
} from "@ee/governance/reactors/gatewayBudgetSync.reactor";
import {
  createGovernanceKpisSyncReactor,
  type GovernanceKpisSyncReactorDeps,
} from "@ee/governance/reactors/governanceKpisSync.reactor";
import {
  createGovernanceOcsfEventsSyncReactor,
  type GovernanceOcsfEventsSyncReactorDeps,
} from "@ee/governance/reactors/governanceOcsfEventsSync.reactor";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import { getProtectionsForProject } from "~/server/api/utils";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { resolveClaudeTurnLogCap } from "~/server/app-layer/traces/claude-code-log-to-span";
import { DatasetRepository } from "~/server/datasets/dataset.repository";
import {
  createDatasetNormalizeHandler,
  type DatasetNormalizePayload,
} from "~/server/datasets/dataset-normalize.job";
import { registerDatasetNormalizeEnqueue } from "~/server/datasets/dataset-normalize.queue";
import { getDatasetStorage } from "~/server/datasets/dataset-storage";
import { featureFlagService } from "~/server/featureFlag";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { TraceService } from "~/server/traces/trace.service";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "../app-layer/billing/billingCheckpoint.service";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import { offloadInputsIfOversized } from "../app-layer/evaluations/evaluation-inputs-offload";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { EvaluationAnalyticsRepository } from "../app-layer/evaluations/repositories/evaluation-analytics.repository";
import type { EvaluationAnalyticsRollupRepository } from "../app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import type { CanonicalLogRecordRepository } from "../app-layer/logs/repositories/canonical-log-record.repository";
import type { MetricDataPointRepository } from "../app-layer/metrics/repositories/metric-data-point.repository";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { OrganizationService } from "../app-layer/organizations/organization.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "../app-layer/traces/repositories/log-record-storage.repository";
import type { TraceAnalyticsRepository } from "../app-layer/traces/repositories/trace-analytics.repository";
import type { TraceAnalyticsRollupRepository } from "../app-layer/traces/repositories/trace-analytics-rollup.repository";
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "../app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import type { TraceSummaryData } from "../app-layer/traces/types";
import type { TriggerService } from "../app-layer/automations/trigger.service";
import type { AutomationAuditRepository } from "../app-layer/automations/repositories/automation-audit.repository";
import type { AutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.wiring";
import { createEvaluationAlertTriggerMatchHandler } from "../event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { createGraphTriggerActivityHandler } from "../event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { getClickHouseClientForProject } from "../clickhouse/clickhouseClient";
import type { RetentionPolicyResolver } from "../data-retention/retentionPolicyResolver";
import { type CommandDispatcher, Deferred } from "./deferred";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import { ReportUsageForMonthCommand } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
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
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import type { ExperimentRunStateData } from "./pipelines/experiment-run-processing/projections/experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import type { ComputeExperimentRunMetricsCommandData } from "./pipelines/experiment-run-processing/schemas/commands";
import { resolveLogCommandShardCount as resolveCanonicalLogCommandShardCount } from "./pipelines/log-processing/canonicalLog";
import { createLogProcessingPipeline } from "./pipelines/log-processing/pipeline";
import { CanonicalLogAppendStore } from "./pipelines/log-processing/projections/stores";
import { resolveMetricCommandShardCount } from "./pipelines/metric-processing/canonical/shards";
import { createMetricProcessingPipeline } from "./pipelines/metric-processing/pipeline";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "./pipelines/metric-processing/projections/stores";
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { createCancellationBroadcastReactor } from "./pipelines/simulation-processing/reactors/cancellationBroadcast.reactor";
import type { ScenarioExecutionReactorHandle } from "./pipelines/simulation-processing/reactors/scenarioExecution.reactor";
import { createScenarioExecutionReactor } from "./pipelines/simulation-processing/reactors/scenarioExecution.reactor";
import { createSnapshotUpdateBroadcastReactor } from "./pipelines/simulation-processing/reactors/snapshotUpdateBroadcast";
import { createSuiteRunSyncReactor } from "./pipelines/simulation-processing/reactors/suiteRunSync.reactor";
import { createTraceMetricsSyncReactor } from "./pipelines/simulation-processing/reactors/traceMetricsSync.reactor";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
import type { ComputeRunMetricsCommandData } from "./pipelines/simulation-processing/schemas/commands";
import { SIMULATION_PROJECTION_VERSIONS } from "./pipelines/simulation-processing/schemas/constants";
import { createLangyConversationProcessingPipeline } from "./pipelines/langy-conversation-processing/pipeline";
import { type LangyConversationStateData } from "./pipelines/langy-conversation-processing/projections/langyConversationState.foldProjection";
import type { LangyConversationTurnData } from "./pipelines/langy-conversation-processing/projections/langyConversationTurn.foldProjection";
import type { LangyMessageProjectionRecord } from "./pipelines/langy-conversation-processing/projections/langyMessageOperational.mapProjection";
import type { LangyAnalyticsEventProjectionRecord } from "./pipelines/langy-conversation-processing/projections/langyAnalyticsEvent.mapProjection";
import type { LangyTitleGenerator } from "../app-layer/langy/langy-title-generation.service";
import type { LangyWorkerPort } from "../app-layer/langy/langyWorker";
import {
  mintLangySessionApiKeyForUser,
  revokeLangySessionApiKey,
} from "../app-layer/langy/langyApiKey";
import {
  createLangyEffectPorts,
  createLangyIntentHandlers,
  LANGY_OUTBOX_LEASE_DURATION_MS,
} from "../app-layer/langy/process-manager/langyEffectPorts";
import {
  createLangyProcessSubscriber,
  langyConversationProcessDefinition,
  LANGY_CONVERSATION_PROCESS_NAME,
} from "../app-layer/langy/process-manager";
import type { LangyTokenBuffer } from "../app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnHandoffStore } from "../app-layer/langy/streaming/langyTurnHandoff";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
} from "../app-layer/langy/subscribers";
import type { LangyTurnAdmissionRepository } from "../app-layer/langy/repositories/langy-turn-admission.repository";
import {
  OutboxDispatcherService,
  ProcessManagerService,
  ProcessOutboxWorker,
  type ProcessStore,
} from "./process-manager";
import { createSuiteRunProcessingPipeline } from "./pipelines/suite-run-processing/pipeline";
import type { SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { SuiteRunStateRepository } from "./pipelines/suite-run-processing/repositories/suiteRunState.repository";
import { SUITE_RUN_PROJECTION_VERSIONS } from "./pipelines/suite-run-processing/schemas/constants";
import { resolveLogCommandShardCount } from "./pipelines/trace-processing/commands/logCommandGroupKey";
import { resolveSpanCommandShardCount } from "./pipelines/trace-processing/commands/spanCommandGroupKey";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "./pipelines/trace-processing/pipeline";
import type { DerivedTraceEvent } from "./pipelines/trace-processing/projections/services/trace-events.derivation";
import { LogRecordAppendStore } from "./pipelines/trace-processing/projections/logRecordStorage.store";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import type { TraceAnalyticsData } from "./pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "./pipelines/trace-processing/projections/traceAnalytics.store";
import { TraceAnalyticsRollupAppendStore } from "./pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createClaudeCodeSpanSyncReactor } from "./pipelines/trace-processing/reactors/claudeCodeSpanSync.reactor";
import { createCustomEvaluationSyncReactor } from "./pipelines/trace-processing/reactors/customEvaluationSync.reactor";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import { createExperimentMetricsSyncReactor } from "./pipelines/trace-processing/reactors/experimentMetricsSync.reactor";
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
import type {
  RecordSpanCommandData,
  ResolveOriginCommandData,
} from "./pipelines/trace-processing/schemas/commands";
import type { FoldProjectionStore } from "./projections/foldProjection.types";
import type { AppendStore } from "./projections/mapProjection.types";
import type { StateProjectionStore } from "./projections/stateProjection.types";
import { createTenantId } from "./domain/tenantId";
import { RedisCachedFoldStore } from "./projections/redisCachedFoldStore";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import { createAutomationsPipeline } from "./pipelines/automations/pipeline";
import { AutomationAuditAppendStore } from "./pipelines/automations/projections/automationAudit.store";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

function mergeClaudeLogRows(
  rows: StoredLogRecordRow[],
  limit?: number,
): StoredLogRecordRow[] {
  const deduped = new Map<string, StoredLogRecordRow>();
  for (const row of rows) {
    // Legacy rows preserve OTLP insertion order while canonical rows are
    // key-sorted (stableStringify), so sort keys before serialising or the
    // same record can produce two different keys and slip past dedup.
    const key = [
      row.traceId,
      row.spanId,
      row.timeUnixMs,
      row.scopeName,
      JSON.stringify(Object.fromEntries(Object.entries(row.attributes).sort())),
    ].join("\0");
    deduped.set(key, row);
  }
  const sorted = [...deduped.values()].sort(
    (left, right) => left.timeUnixMs - right.timeUnixMs,
  );
  return typeof limit === "number" && limit > 0
    ? sorted.slice(0, limit)
    : sorted;
}

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
  suiteRunState: SuiteRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  simulationRunState: SimulationRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  experimentRunState: ExperimentRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  traceSummaryFold: TraceSummaryRepository;
  logRecordStorage: LogRecordStorageRepository;
  canonicalLogStorage: CanonicalLogRecordRepository;
  metricDataPointStorage: MetricDataPointRepository;
  /** ADR-034 Phase 1: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-034 Phase 2: slim per-trace analytics repository (dual-tap). */
  traceAnalytics: TraceAnalyticsRepository;
  /** ADR-034 Phase 6: per-evaluation rollup repository. */
  evaluationAnalyticsRollup: EvaluationAnalyticsRollupRepository;
  /** ADR-034 Phase 6: slim per-evaluation analytics repository. */
  evaluationAnalytics: EvaluationAnalyticsRepository;
  automationAudit: AutomationAuditRepository;
  experimentRunItemStorage: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** Direct Postgres operational projection; deliberately bypasses Redis. */
  langyConversationState: StateProjectionStore<LangyConversationStateData>;
  /** Direct Postgres per-turn operational projection. */
  langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  /** Postgres per-message operational projection. */
  langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free ClickHouse event-grain analytics. */
  langyAnalyticsEventStorage: AppendStore<LangyAnalyticsEventProjectionRecord>;
  /** Durable process inbox, state, and outbox persistence. */
  langyProcessStore: ProcessStore;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  langyTurnAdmission: LangyTurnAdmissionRepository;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  repositories: PipelineRepositories;
  redis: Redis | Cluster;
  broadcast: BroadcastService;
  langy: {
    buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
    handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
    worker: Pick<LangyWorkerPort, "dispatch">;
    titleGenerator: LangyTitleGenerator;
    runsWorkers: boolean;
  };
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
  gatewayBudgetSync?: GatewayBudgetSyncReactorDeps;
  /**
   * ADR-022: BlobStore for RecordSpanCommand spool reconstitution.
   * When provided, the trace-processing pipeline wires it into RecordSpanCommand
   * so oversized commands (> 256 KB) are fetched from S3 and the spool is
   * best-effort DELETEd after event_log INSERT succeeds.
   */
  blobStore?: BlobStore;
  governanceKpisSync?: GovernanceKpisSyncReactorDeps;
  governanceOcsfEventsSync?: GovernanceOcsfEventsSyncReactorDeps;
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

  private cached<State>(
    inner: FoldProjectionStore<State>,
    keyPrefix: string,
  ): FoldProjectionStore<State> {
    return new RedisCachedFoldStore<State>(inner, this.deps.redis as Redis, {
      keyPrefix,
    });
  }

  registerAll() {
    // TODO: Customer.io reactors are implemented but not yet registered.
    // Counting strategy needs to be finalised (per-event ClickHouse queries)
    // before enabling.
    // See: customerIoTraceSyncReactor, customerIoEvaluationSyncReactor,
    //      customerIoSimulationSyncReactor

    const traceSummaryStore = this.cached<TraceSummaryData>(
      new TraceSummaryStore(this.deps.repositories.traceSummaryFold),
      "trace_summaries",
    );

    const automationPorts = this.deps.automations.ports;
    const graphActivityHandler = createGraphTriggerActivityHandler({
      triggers: this.deps.triggers,
      evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
    });
    const automationPipeline = this.deps.eventSourcing.register(
      createAutomationsPipeline({
        automationAuditStore: new AutomationAuditAppendStore(
          this.deps.repositories.automationAudit,
        ),
        dispatch: automationPorts.settlementDeps,
        sweep: {
          decideSweepCandidates: automationPorts.decideSweepCandidates,
          evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.langyProcessStore.deleteDispatchedBefore(
              params,
            ),
        },
        prune: {
          pruneExpired: automationPorts.pruneWebhookDeliveries,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.langyProcessStore.deleteDispatchedBefore(
              params,
            ),
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
    const metricPipeline = this.registerMetricPipeline();
    const logPipeline = this.registerLogPipeline();
    const {
      pipeline: tracePipeline,
      simComputeRunMetrics,
      wireExperimentDeps,
    } = this.registerTracePipeline({
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
    });
    const suiteRunPipeline = this.registerSuiteRunPipeline();
    const { pipeline: simulationPipeline, scenarioExecutionHandle } =
      this.registerSimulationPipeline({
        suiteRunPipeline,
        traceSummaryStore,
        simComputeRunMetrics,
      });

    const experimentRunPipeline = this.registerExperimentRunPipeline({
      wireExperimentDeps,
    });
    const { pipeline: langyConversationPipeline, processOutboxWorker } =
      this.registerLangyConversationPipeline();
    const billingPipeline = this.registerBillingReportingPipeline();

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      metrics: mapCommands(metricPipeline.commands),
      logs: mapCommands(logPipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      suiteRuns: mapCommands(suiteRunPipeline.commands),
      langy: mapCommands(langyConversationPipeline.commands),
      billing: mapCommands(billingPipeline.commands),
      automations: automationCommands,
      /** Late-bind the execution pool for scenario execution reactor. */
      scenarioExecutionHandle,
      // Starting and notifying are private composition concerns so a web role
      // cannot accidentally start the worker. App shutdown only needs stop().
      processOutboxWorker: {
        stop: () => processOutboxWorker.stop(),
      },
    };
  }

  /** Langy writes its low-latency operational projections directly to Postgres. */
  private registerLangyConversationPipeline() {
    const conversationStore = this.deps.repositories.langyConversationState;
    const failTurn = new Deferred<
      (args: {
        projectId: string;
        conversationId: string;
        turnId: string;
        error: string;
      }) => Promise<void>
    >("langyFailTurn");
    const saveTitle = new Deferred<
      (args: {
        projectId: string;
        conversationId: string;
        turnId: string;
        title: string;
        model: string;
      }) => Promise<void>
    >("langyGenerateTitle");

    const processManager = new ProcessManagerService({
      definition: langyConversationProcessDefinition,
      store: this.deps.repositories.langyProcessStore,
    });
    const effectPorts = createLangyEffectPorts({
      handoffStore: this.deps.langy.handoffStore,
      worker: this.deps.langy.worker,
      mintSessionKey: ({ userId, projectId, organizationId }) =>
        mintLangySessionApiKeyForUser({
          prisma: this.deps.prisma,
          userId,
          projectId,
          organizationId,
        }),
      revokeSessionKey: ({ apiKeyId }) =>
        revokeLangySessionApiKey({
          prisma: this.deps.prisma,
          apiKeyId,
        }).then(() => undefined),
      titleGenerator: this.deps.langy.titleGenerator,
      saveTitle: (args) => saveTitle.fn(args),
    });
    const outboxDispatcher = new OutboxDispatcherService({
      store: this.deps.repositories.langyProcessStore,
      handlers: createLangyIntentHandlers({ ports: effectPorts }),
      logger,
      processNames: [LANGY_CONVERSATION_PROCESS_NAME],
      // The lease MUST outlive the slowest accepted dispatch, or a healthy
      // long-running turn loses its lease mid-flight and a second instance
      // re-delivers it concurrently (the completing handler is then fenced
      // out and the message never retires). The generic 30s default is unsafe
      // against the 60s dispatch budget.
      leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS,
    });
    const processOutboxWorker = new ProcessOutboxWorker({
      dispatcher: outboxDispatcher,
      logger,
    });

    const conversationReader = {
      read: async ({
        projectId,
        conversationId,
      }: {
        projectId: string;
        conversationId: string;
      }) => {
        const projection = await conversationStore.load(conversationId, {
          tenantId: createTenantId(projectId),
          aggregateId: conversationId,
        });
        if (!projection) return null;
        return {
          cursor: projection.cursor,
          status: projection.state.Status,
          currentTurnId: projection.state.CurrentTurnId,
          lastActivityAtMs: projection.state.LastActivityAt,
          ownerUserId: projection.state.UserId,
          isShared: projection.state.IsShared,
        };
      },
    };

    const processSubscriber = createLangyProcessSubscriber({
      processManager,
      notifyOutbox: () => processOutboxWorker.notify(),
    });
    const livenessSubscriber = createAgentTurnLivenessSubscriber({
      buffer: this.deps.langy.buffer,
      conversations: conversationReader,
      failTurn: { failTurn: (args) => failTurn.fn(args) },
      worker: this.deps.langy.worker,
      handoffStore: this.deps.langy.handoffStore,
    });
    const broadcastSubscriber =
      createLangyConversationUpdateBroadcastSubscriber({
        broadcast: this.deps.broadcast,
        conversations: conversationReader,
      });
    const admissionLifecycleSubscriber =
      createLangyTurnAdmissionLifecycleSubscriber({
        admissions: this.deps.repositories.langyTurnAdmission,
      });

    const pipeline = this.deps.eventSourcing.register(
      createLangyConversationProcessingPipeline({
        langyConversationProjectionStore: conversationStore,
        langyConversationTurnProjectionStore:
          this.deps.repositories.langyConversationTurnState,
        langyMessageProjectionStore: this.deps.repositories.langyMessageStorage,
        langyAnalyticsEventProjectionStore:
          this.deps.repositories.langyAnalyticsEventStorage,
        subscribers: [
          processSubscriber,
          livenessSubscriber,
          broadcastSubscriber,
          admissionLifecycleSubscriber,
        ],
      }),
    );

    const commands = mapCommands(pipeline.commands);
    failTurn.resolve((args) =>
      commands.failAgentResponse({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        error: args.error,
      }),
    );
    saveTitle.resolve((args) =>
      commands.generateConversationTitle({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        title: args.title,
        source: "auto",
        model: args.model,
      }),
    );
    if (this.deps.langy.runsWorkers) {
      processOutboxWorker.start();
    }
    return { pipeline, processOutboxWorker };
  }

  private registerMetricPipeline() {
    const repository = this.deps.repositories.metricDataPointStorage;
    return this.deps.eventSourcing.register(
      createMetricProcessingPipeline({
        metricDataPointAppendStore: new MetricDataPointAppendStore(repository),
        metricSeriesCatalogAppendStore: new MetricSeriesCatalogAppendStore(
          repository,
        ),
        metricTimeRollupAppendStore: new MetricTimeRollupAppendStore(
          repository,
        ),
        metricCommandShardCount: resolveMetricCommandShardCount(
          process.env.METRIC_PROCESSING_SHARDS,
        ),
      }),
    );
  }

  private registerLogPipeline() {
    return this.deps.eventSourcing.register(
      createLogProcessingPipeline({
        canonicalLogAppendStore: new CanonicalLogAppendStore(
          this.deps.repositories.canonicalLogStorage,
        ),
        logCommandShardCount: resolveCanonicalLogCommandShardCount(
          process.env.LOG_PROCESSING_SHARDS,
        ),
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
        // Redis cache is the eval slim fold's ONLY warm read path — its
        // store's get() returns null by design (lossy row, no read-back),
        // and on a cache miss the fold's refoldOnStoreMiss option rebuilds
        // state from the event log. Same wiring as trace_analytics.
        evaluationAnalyticsStore: this.cached<EvaluationAnalyticsData>(
          new EvaluationAnalyticsStore(
            this.deps.repositories.evaluationAnalytics,
          ),
          "evaluation_analytics",
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
  }: {
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    automations: TraceProcessingPipelineDeps["automations"];
  }) {
    const evalCommands = mapCommands(evalPipeline.commands);

    // Deferred dispatchers — resolved after pipeline registration.
    const resolveOrigin = new Deferred<
      CommandDispatcher<ResolveOriginCommandData>
    >("resolveOrigin");
    const scheduleDeferred = new Deferred<
      (payload: DeferredOriginPayload) => Promise<void>
    >("scheduleDeferred");
    const simComputeRunMetrics = new Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >("simComputeRunMetrics");
    // recordSpan is a command of the trace pipeline itself, so the claude
    // span-sync reactor that dispatches it is wired after registration.
    const recordSpanDispatch = new Deferred<
      CommandDispatcher<RecordSpanCommandData>
    >("recordSpan");

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

    const claudeCodeSpanSyncReactor = createClaudeCodeSpanSyncReactor({
      getMarkedClaudeCodeLogs: async (
        tenantId,
        traceId,
        occurredAtMs,
        limit,
      ) => {
        const [canonical, legacy] = await Promise.all([
          this.deps.repositories.canonicalLogStorage.getMarkedClaudeCodeLogsByTrace(
            { tenantId, traceId, occurredAtMs, limit },
          ),
          this.deps.repositories.logRecordStorage.getMarkedClaudeCodeLogsByTrace(
            tenantId,
            traceId,
            occurredAtMs,
            limit,
          ),
        ]);
        return mergeClaudeLogRows([...canonical, ...legacy], limit);
      },
      countMarkedClaudeCodeLogs: async (tenantId, traceId, occurredAtMs) => {
        const [canonical, legacy] = await Promise.all([
          this.deps.repositories.canonicalLogStorage.countMarkedClaudeCodeLogsByTrace(
            { tenantId, traceId, occurredAtMs },
          ),
          this.deps.repositories.logRecordStorage.countMarkedClaudeCodeLogsByTrace(
            tenantId,
            traceId,
            occurredAtMs,
          ),
        ]);
        return canonical + legacy;
      },
      // Per-turn conversion cap (env LANGWATCH_CLAUDE_TURN_LOG_CAP, default
      // CLAUDE_TURN_LOG_CAP). Bounds how many of a pathological turn's marked
      // logs the span-sync reactor folds in one pass so a runaway turn can't
      // seize the worker; the root span is marked truncated when the cap bites.
      turnLogCap: resolveClaudeTurnLogCap(
        process.env.LANGWATCH_CLAUDE_TURN_LOG_CAP,
      ),
      recordSpan: recordSpanDispatch.fn,
    });

    const projectMetadataReactor = createProjectMetadataReactor({
      projects: this.deps.projects,
    });

    const simulationMetricsSyncReactor = createSimulationMetricsSyncReactor({
      computeRunMetrics: simComputeRunMetrics.fn,
    });

    // Late-bound reference for experiment metrics sync reactor.
    // The experiment pipeline is registered after the trace pipeline,
    // so computeExperimentRunMetrics is wired after experiment pipeline registration.
    let expComputeRunMetrics:
      | ((data: ComputeExperimentRunMetricsCommandData) => Promise<void>)
      | null = null;
    let expLookupExperimentId:
      | ((tenantId: string, runId: string) => Promise<string | null>)
      | null = null;

    const experimentMetricsSyncReactor = createExperimentMetricsSyncReactor({
      computeExperimentRunMetrics: async (data) => {
        if (!expComputeRunMetrics) {
          logger.warn(
            "experiment computeExperimentRunMetrics not yet initialized, skipping",
          );
          return;
        }
        return expComputeRunMetrics(data);
      },
      lookupExperimentId: async (tenantId, runId) => {
        if (!expLookupExperimentId) {
          logger.warn(
            "experiment lookupExperimentId not yet initialized, skipping",
          );
          return null;
        }
        return expLookupExperimentId(tenantId, runId);
      },
    });

    const gatewayBudgetSyncReactor = this.deps.gatewayBudgetSync
      ? createGatewayBudgetSyncReactor(this.deps.gatewayBudgetSync)
      : undefined;

    const governanceKpisSyncReactor = this.deps.governanceKpisSync
      ? createGovernanceKpisSyncReactor(this.deps.governanceKpisSync)
      : undefined;

    const governanceOcsfEventsSyncReactor = this.deps.governanceOcsfEventsSync
      ? createGovernanceOcsfEventsSyncReactor(
          this.deps.governanceOcsfEventsSync,
        )
      : undefined;

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        traceAnalyticsRollupAppendStore: new TraceAnalyticsRollupAppendStore(
          this.deps.repositories.traceAnalyticsRollup,
        ),
        // CUTOVER ONLY — see TraceProcessingPipelineDeps.logRecordAppendStore.
        logRecordAppendStore: new LogRecordAppendStore(
          this.deps.repositories.logRecordStorage,
        ),
        // Redis cache is the slim fold's ONLY warm read path — its store's
        // get() returns null by design (lossy row, no read-back), and on a
        // cache miss the fold's refoldOnStoreMiss option rebuilds state from
        // the event log. Without this wrapper every event would trigger a
        // full event-log re-fold.
        traceAnalyticsStore: this.cached<TraceAnalyticsData>(
          new TraceAnalyticsStore(this.deps.repositories.traceAnalytics),
          "trace_analytics",
        ),
        traceSummaryStore,
        originGateReactor,
        evaluationTriggerReactor,
        automations,
        customEvaluationSyncReactor,
        traceUpdateBroadcastReactor,
        projectMetadataReactor,
        simulationMetricsSyncReactor,
        experimentMetricsSyncReactor,
        spanStorageBroadcastReactor,
        claudeCodeSpanSyncReactor,
        gatewayBudgetSyncReactor,
        // ADR-022: Wire BlobStore so RecordSpanCommand can reconstitute
        // oversized commands and best-effort delete the transient S3 spool.
        blobStore: this.deps.blobStore,
        // Span-command sharding fan-out (env TRACE_SPAN_PROCESSING_SHARDS,
        // default 1 = disabled). Lets a hot trace's recordSpan commands drain in
        // parallel across `traceId:<shard>` GroupQueue groups; fold stays per-trace.
        spanCommandShardCount: resolveSpanCommandShardCount(
          process.env.TRACE_SPAN_PROCESSING_SHARDS,
        ),
        // Log-command sharding fan-out, ON by default (4 lanes; env
        // TRACE_LOG_PROCESSING_SHARDS tunes it, 1 disables). Lets one Claude
        // Code turn's recordLog commands drain in parallel across
        // `traceId:<shard>` GroupQueue groups; the fold and the
        // claude-span-sync reactor stay per-trace.
        logCommandShardCount: resolveLogCommandShardCount(
          process.env.TRACE_LOG_PROCESSING_SHARDS,
        ),
        governanceKpisSyncReactor,
        governanceOcsfEventsSyncReactor,
      }),
    );

    // Resolve self-referencing commands now that the pipeline is registered
    const traceCommands = mapCommands(tracePipeline.commands);
    resolveOrigin.resolve(traceCommands.resolveOrigin);
    recordSpanDispatch.resolve(traceCommands.recordSpan);

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
      /** Cross-pipeline deferred — resolved by registerSimulationPipeline. */
      simComputeRunMetrics,
      /**
       * Wires late-bound experiment computeExperimentRunMetrics and
       * lookupExperimentId into the trace-side experimentMetricsSync reactor.
       * Called after the experiment pipeline is registered.
       */
      wireExperimentDeps: (deps: {
        computeExperimentRunMetrics: (
          data: ComputeExperimentRunMetricsCommandData,
        ) => Promise<void>;
        lookupExperimentId: (
          tenantId: string,
          runId: string,
        ) => Promise<string | null>;
      }) => {
        expComputeRunMetrics = deps.computeExperimentRunMetrics;
        expLookupExperimentId = deps.lookupExperimentId;
      },
    };
  }

  private registerSuiteRunPipeline() {
    return this.deps.eventSourcing.register(
      createSuiteRunProcessingPipeline({
        suiteRunStateFoldStore: this.cached<SuiteRunStateData>(
          new RepositoryFoldStore<SuiteRunStateData>(
            this.deps.repositories.suiteRunState,
            SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
          ),
          "suite_runs",
        ),
      }),
    );
  }

  private registerSimulationPipeline({
    suiteRunPipeline,
    traceSummaryStore,
    simComputeRunMetrics,
  }: {
    suiteRunPipeline: ReturnType<PipelineRegistry["registerSuiteRunPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    simComputeRunMetrics: Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >;
  }) {
    const simulationRunStore = this.cached<SimulationRunStateData>(
      new RepositoryFoldStore<SimulationRunStateData>(
        this.deps.repositories.simulationRunState,
        SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      ),
      "simulation_runs",
    );
    const snapshotUpdateBroadcastReactor = createSnapshotUpdateBroadcastReactor(
      {
        broadcast: this.deps.broadcast,
        hasRedis: !!this.deps.eventSourcing.redisConnection,
      },
    );

    const cancellationBroadcastReactor = createCancellationBroadcastReactor({
      publisher: this.deps.eventSourcing.redisConnection ?? null,
    });

    const scenarioExecutionHandle = createScenarioExecutionReactor();

    const suiteRunCommands = mapCommands(suiteRunPipeline.commands);
    const suiteRunSyncReactor = createSuiteRunSyncReactor({
      recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
      completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
    });

    // Deferred dispatchers — resolved after pipeline registration.
    const selfComputeRunMetrics = new Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >("selfComputeRunMetrics");
    const scheduleRetry = new Deferred<
      (payload: ComputeRunMetricsCommandData) => Promise<void>
    >("scheduleRetry");

    const traceReadDerivation = new TraceReadDerivationService(
      this.deps.traces.spans,
    );
    const computeRunMetricsCommand = new ComputeRunMetricsCommand({
      traceSummaryStore,
      scheduleRetry: scheduleRetry.fn,
      deriveScenarioRoleMetrics: (params) =>
        traceReadDerivation.deriveScenarioRoleMetrics(params),
    });

    const traceMetricsSyncReactor = createTraceMetricsSyncReactor({
      computeRunMetrics: selfComputeRunMetrics.fn,
    });

    const simulationPipeline = this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        snapshotUpdateBroadcastReactor,
        cancellationBroadcastReactor,
        scenarioExecutionReactor: scenarioExecutionHandle.reactor,
        suiteRunSyncReactor,
        traceMetricsSyncReactor,
        computeRunMetricsCommand,
      }),
    );

    // Resolve self-referencing command
    const simCommands = mapCommands(simulationPipeline.commands);
    selfComputeRunMetrics.resolve(simCommands.computeRunMetrics);

    // Resolve cross-pipeline deferred (trace → simulation)
    simComputeRunMetrics.resolve(simCommands.computeRunMetrics);

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
    const reportUsageForMonthCommand = new ReportUsageForMonthCommand({
      organizations: this.deps.organizations,
      billingCheckpoints: this.deps.billingCheckpoints,
      getUsageReportingService: () => this.deps.usageReportingService,
      queryBillableEventsTotal,
      selfDispatch: (data) => {
        const pipeline = this.deps.eventSourcing.getPipeline(
          BILLING_REPORTING_PIPELINE_NAME,
        );
        return pipeline.commands.reportUsageForMonth.send(data);
      },
    });

    return this.deps.eventSourcing.register(
      createBillingReportingPipeline({
        reportUsageForMonthCommand,
      }),
    );
  }

  private registerExperimentRunPipeline({
    wireExperimentDeps,
  }: {
    wireExperimentDeps: ReturnType<
      PipelineRegistry["registerTracePipeline"]
    >["wireExperimentDeps"];
  }) {
    const experimentRunStore = this.cached<ExperimentRunStateData>(
      createExperimentRunStateFoldStore(
        this.deps.repositories.experimentRunState,
      ),
      "experiment_runs",
    );

    const experimentRunPipeline = this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore: experimentRunStore,
        experimentRunItemAppendStore:
          this.deps.repositories.experimentRunItemStorage,
      }),
    );

    // Wire the trace-side experimentMetricsSync reactor's late-bound deps
    const expCommands = mapCommands(experimentRunPipeline.commands);

    // Create the experimentId lookup function using the experiment run ClickHouse repository
    const lookupExperimentId = async (
      tenantId: string,
      runId: string,
    ): Promise<string | null> => {
      try {
        const client = await getClickHouseClientForProject(tenantId);
        if (!client) return null;

        const result = await client.query({
          query: `
            SELECT ExperimentId
            FROM experiment_runs
            WHERE TenantId = {tenantId:String}
              AND RunId = {runId:String}
            ORDER BY UpdatedAt DESC
            LIMIT 1
          `,
          query_params: { tenantId, runId },
          format: "JSONEachRow",
        });

        const rows = await result.json<{ ExperimentId: string }>();
        return rows[0]?.ExperimentId ?? null;
      } catch (error) {
        logger.warn(
          { tenantId, runId, error },
          "Failed to lookup experimentId for trace metrics sync",
        );
        return null;
      }
    };

    wireExperimentDeps({
      computeExperimentRunMetrics: expCommands.computeExperimentRunMetrics,
      lookupExperimentId,
    });

    return experimentRunPipeline;
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

export interface ReactorMetadata {
  reactorName: string;
  pipelineName: string;
  aggregateType: string;
  afterProjection: string;
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

export function getReactorMetadata(): ReactorMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.foldReactors.values()).map(
      ({ projectionName, definition }) => ({
        reactorName: definition.name,
        pipelineName,
        aggregateType,
        afterProjection: projectionName,
      }),
    );
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
  componentType: "projection" | "mapProjection" | "command";
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
