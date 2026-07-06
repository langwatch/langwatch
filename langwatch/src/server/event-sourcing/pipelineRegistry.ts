import { createAlertTriggerReactor } from "@ee/governance/reactors/alertTrigger.reactor";
import { createAlertTriggerNotifyOutboxReactor } from "@ee/governance/reactors/alertTriggerNotifyOutbox.reactor";
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
import type { PrismaClient } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import { getProtectionsForProject } from "~/server/api/utils";
import { DatasetRepository } from "~/server/datasets/dataset.repository";
import {
  createDatasetNormalizeHandler,
  type DatasetNormalizePayload,
} from "~/server/datasets/dataset-normalize.job";
import { registerDatasetNormalizeEnqueue } from "~/server/datasets/dataset-normalize.queue";
import { getDatasetStorage } from "~/server/datasets/dataset-storage";
import { TraceService } from "~/server/traces/trace.service";
import { createLogger } from "~/utils/logger/server";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "../app-layer/billing/billingCheckpoint.service";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { EvaluationAnalyticsRepository } from "../app-layer/evaluations/repositories/evaluation-analytics.repository";
import type { EvaluationAnalyticsRollupRepository } from "../app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import type { ExperimentAnalyticsRepository } from "../app-layer/experiments/repositories/experiment-analytics.repository";
import type { ExperimentAnalyticsRollupRepository } from "../app-layer/experiments/repositories/experiment-analytics-rollup.repository";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { OrganizationService } from "../app-layer/organizations/organization.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import type { SimulationAnalyticsRepository } from "../app-layer/scenarios/repositories/simulation-analytics.repository";
import type { SimulationAnalyticsRollupRepository } from "../app-layer/scenarios/repositories/simulation-analytics-rollup.repository";
import type { SuiteAnalyticsRepository } from "../app-layer/suites/repositories/suite-analytics.repository";
import type { SuiteAnalyticsRollupRepository } from "../app-layer/suites/repositories/suite-analytics-rollup.repository";
import type { LogRecordStorageRepository } from "../app-layer/traces/repositories/log-record-storage.repository";
import type { MetricRecordStorageRepository } from "../app-layer/traces/repositories/metric-record-storage.repository";
import type { TraceAnalyticsRepository } from "../app-layer/traces/repositories/trace-analytics.repository";
import type { TraceAnalyticsRollupRepository } from "../app-layer/traces/repositories/trace-analytics-rollup.repository";
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "../app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import type { TraceSummaryData } from "../app-layer/traces/types";
import type { TriggerService } from "../app-layer/triggers/trigger.service";
import { getClickHouseClientForProject } from "../clickhouse/clickhouseClient";
import type { RetentionPolicyResolver } from "../data-retention/retentionPolicyResolver";
import { createElasticsearchBatchEvaluationRepository } from "../experiments-v3/repositories/elasticsearchBatchEvaluation.repository";
import { type CommandDispatcher, Deferred } from "./deferred";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import type { OutboxRuntime } from "./outbox/setup";
import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import { ReportUsageForMonthCommand } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import { createEvaluationProcessingPipeline } from "./pipelines/evaluation-processing/pipeline";
import { EvaluationAnalyticsStore } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.store";
import { EvaluationAnalyticsRollupAppendStore } from "./pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.store";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import { createEvaluationAlertTriggerReactor } from "./pipelines/evaluation-processing/reactors/evaluationAlertTrigger.reactor";
import { createEvaluationAlertTriggerNotifyOutboxReactor } from "./pipelines/evaluation-processing/reactors/evaluationAlertTriggerNotifyOutbox.reactor";
import type { EvaluationEsSyncReactorDeps } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationEsSyncReactor } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationGraphTriggerEvaluationOutboxReactor } from "./pipelines/evaluation-processing/reactors/graphTriggerEvaluation.outboxReactor";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import { ExperimentAnalyticsStore } from "./pipelines/experiment-run-processing/projections/experimentAnalytics.store";
import { ExperimentAnalyticsRollupAppendStore } from "./pipelines/experiment-run-processing/projections/experimentAnalyticsRollup.store";
import type { ClickHouseExperimentRunResultRecord } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection";
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import type { ExperimentRunStateData } from "./pipelines/experiment-run-processing/projections/experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import { createExperimentRunEsSyncReactor } from "./pipelines/experiment-run-processing/reactors/experimentRunEsSync.reactor";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import type { ComputeExperimentRunMetricsCommandData } from "./pipelines/experiment-run-processing/schemas/commands";
import type { TriggerActionDispatchDeps } from "./pipelines/shared/triggerActionDispatch";
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import { SimulationAnalyticsStore } from "./pipelines/simulation-processing/projections/simulationAnalytics.store";
import { SimulationAnalyticsRollupAppendStore } from "./pipelines/simulation-processing/projections/simulationAnalyticsRollup.store";
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
import { createSuiteRunProcessingPipeline } from "./pipelines/suite-run-processing/pipeline";
import { SuiteAnalyticsStore } from "./pipelines/suite-run-processing/projections/suiteAnalytics.store";
import { SuiteAnalyticsRollupAppendStore } from "./pipelines/suite-run-processing/projections/suiteAnalyticsRollup.store";
import type { SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { SuiteRunStateRepository } from "./pipelines/suite-run-processing/repositories/suiteRunState.repository";
import { SUITE_RUN_PROJECTION_VERSIONS } from "./pipelines/suite-run-processing/schemas/constants";
import { createTraceProcessingPipeline } from "./pipelines/trace-processing/pipeline";
import { LogRecordAppendStore } from "./pipelines/trace-processing/projections/logRecordStorage.store";
import { MetricRecordAppendStore } from "./pipelines/trace-processing/projections/metricRecordStorage.store";
import type { DerivedTraceEvent } from "./pipelines/trace-processing/projections/services/trace-events.derivation";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import { TraceAnalyticsStore } from "./pipelines/trace-processing/projections/traceAnalytics.store";
import { TraceAnalyticsRollupAppendStore } from "./pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createClaudeCodeSpanSyncReactor } from "./pipelines/trace-processing/reactors/claudeCodeSpanSync.reactor";
import { createCustomEvaluationSyncReactor } from "./pipelines/trace-processing/reactors/customEvaluationSync.reactor";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import { createExperimentMetricsSyncReactor } from "./pipelines/trace-processing/reactors/experimentMetricsSync.reactor";
import { createGraphTriggerEvaluationOutboxReactor } from "./pipelines/trace-processing/reactors/graphTriggerEvaluation.outboxReactor";
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
import { RedisCachedFoldStore } from "./projections/redisCachedFoldStore";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";

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
  suiteRunState: SuiteRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  simulationRunState: SimulationRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  experimentRunState: ExperimentRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  traceSummaryFold: TraceSummaryRepository;
  logRecordStorage: LogRecordStorageRepository;
  metricRecordStorage: MetricRecordStorageRepository;
  /** ADR-034 Phase 1: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-034 Phase 2: slim per-trace analytics repository (dual-tap, no read path yet). */
  traceAnalytics: TraceAnalyticsRepository;
  /** ADR-034 Phase 6: per-evaluation rollup repository. */
  evaluationAnalyticsRollup: EvaluationAnalyticsRollupRepository;
  /** ADR-034 Phase 6: slim per-evaluation analytics repository. */
  evaluationAnalytics: EvaluationAnalyticsRepository;
  /** ADR-034 Phase 7: per-simulation-run rollup repository. */
  simulationAnalyticsRollup: SimulationAnalyticsRollupRepository;
  /** ADR-034 Phase 7: slim per-simulation-run analytics repository. */
  simulationAnalytics: SimulationAnalyticsRepository;
  /** ADR-034 Phase 7: per-experiment-run rollup repository. */
  experimentAnalyticsRollup: ExperimentAnalyticsRollupRepository;
  /** ADR-034 Phase 7: slim per-experiment-run analytics repository. */
  experimentAnalytics: ExperimentAnalyticsRepository;
  /** ADR-034 Phase 7: per-item suite rollup repository. */
  suiteAnalyticsRollup: SuiteAnalyticsRollupRepository;
  /** ADR-034 Phase 7: slim per-suite-run analytics repository. */
  suiteAnalytics: SuiteAnalyticsRepository;
  experimentRunItemStorage: AppendStore<ClickHouseExperimentRunResultRecord>;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  repositories: PipelineRepositories;
  redis: Redis | Cluster;
  broadcast: BroadcastService;
  projects: ProjectService;
  monitors: MonitorService;
  triggers: TriggerService;
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
  esSync: EvaluationEsSyncReactorDeps;
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
  blobStore?: import("~/server/app-layer/traces/blob-store.service").BlobStore;
  governanceKpisSync?: GovernanceKpisSyncReactorDeps;
  governanceOcsfEventsSync?: GovernanceOcsfEventsSyncReactorDeps;
  /**
   * Wired by the worker composition root (`presets.ts`) and `undefined`
   * on the web process. When set, all four trigger reactors route their
   * matches into the unified outbox queue's settle stage (ADR-030 +
   * ADR-026 + ADR-035) — both NOTIFY (email / Slack) and PERSIST
   * (dataset / annotation) classes now ride settle → cadence; nothing
   * dispatches inline.
   */
  outbox?: OutboxRuntime;
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
    // Counting strategy needs to be finalised (extend R5 daily sync pattern
    // vs per-event ClickHouse queries) before enabling.
    // See: customerIoDailyUsageSyncReactor, customerIoTraceSyncReactor,
    //      customerIoEvaluationSyncReactor, customerIoSimulationSyncReactor

    const traceSummaryStore = this.cached<TraceSummaryData>(
      new TraceSummaryStore(this.deps.repositories.traceSummaryFold),
      "trace_summaries",
    );

    const evalPipeline = this.registerEvaluationPipeline({ traceSummaryStore });
    const {
      pipeline: tracePipeline,
      simComputeRunMetrics,
      wireExperimentDeps,
    } = this.registerTracePipeline({ evalPipeline, traceSummaryStore });
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
    const billingPipeline = this.registerBillingReportingPipeline();

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      suiteRuns: mapCommands(suiteRunPipeline.commands),
      billing: mapCommands(billingPipeline.commands),
      /** Late-bind the execution pool for scenario execution reactor. */
      scenarioExecutionHandle,
    };
  }

  private registerEvaluationPipeline({
    traceSummaryStore,
  }: {
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  }) {
    const executeEvaluationCommand = new ExecuteEvaluationCommand({
      monitors: this.deps.monitors,
      spanStorage: this.deps.traces.spans,
      traceEvents: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
      costRecorder: this.deps.costRecorder,
      azureSafetyEnvResolver: getAzureSafetyEnvFromProject,
    });

    const esSyncReactor = createEvaluationEsSyncReactor(this.deps.esSync);

    // ADR-035: the persist branch is now an outbox reactor that only
    // enqueues settle payloads. Filter evaluation + dispatch (traceById /
    // addToDataset / addToAnnotationQueue) moved to the outbox dispatcher
    // (see buildOutboxRuntime), so this reactor needs just the trigger
    // service and the trace fold store for the enqueue breadcrumb.
    const evaluationAlertTriggerReactor = createEvaluationAlertTriggerReactor({
      triggers: this.deps.triggers,
      traceSummaryStore,
    });

    const evaluationAlertTriggerNotifyOutboxReactor =
      createEvaluationAlertTriggerNotifyOutboxReactor({
        triggers: this.deps.triggers,
        traceSummaryStore,
      });

    // ADR-034 Phase 6: real-time graph-trigger reactor on the slim eval fold.
    // Flag-gated per project via the same `release_es_graph_triggers_firing`
    // flag the trace pipeline uses — disabled = empty decide; cron handles
    // the project's graph triggers as today.
    const graphTriggerEvaluationOutboxReactor =
      createEvaluationGraphTriggerEvaluationOutboxReactor({
        triggers: this.deps.triggers,
      });

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        evaluationAnalyticsStore: new EvaluationAnalyticsStore(
          this.deps.repositories.evaluationAnalytics,
        ),
        evaluationAnalyticsRollupAppendStore:
          new EvaluationAnalyticsRollupAppendStore(
            this.deps.repositories.evaluationAnalyticsRollup,
          ),
        executeEvaluationCommand,
        esSyncReactor,
        evaluationAlertTriggerReactor,
        evaluationAlertTriggerNotifyOutboxReactor,
        graphTriggerEvaluationOutboxReactor,
      }),
    );
  }

  private registerTracePipeline({
    evalPipeline,
    traceSummaryStore,
  }: {
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
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

    // ADR-035: the persist branch is now an outbox reactor that only
    // enqueues settle payloads; dispatch deps live on the outbox
    // dispatcher (see buildOutboxRuntime), so this reactor needs just the
    // trigger service.
    const alertTriggerReactor = createAlertTriggerReactor({
      triggers: this.deps.triggers,
    });

    const alertTriggerNotifyOutboxReactor =
      createAlertTriggerNotifyOutboxReactor({
        triggers: this.deps.triggers,
      });

    // ADR-034 Phase 5: real-time path for custom-graph threshold alerts.
    // Flag-gated per project inside `decide` so a flag-OFF project sees
    // an empty enqueue list and the cron handles its graph triggers
    // unchanged.
    const graphTriggerEvaluationOutboxReactor =
      createGraphTriggerEvaluationOutboxReactor({
        triggers: this.deps.triggers,
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
      getMarkedClaudeCodeLogs: (tenantId, traceId, occurredAtMs) =>
        this.deps.repositories.logRecordStorage.getMarkedClaudeCodeLogsByTrace(
          tenantId,
          traceId,
          occurredAtMs,
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
        traceAnalyticsStore: new TraceAnalyticsStore(
          this.deps.repositories.traceAnalytics,
        ),
        logRecordAppendStore: new LogRecordAppendStore(
          this.deps.repositories.logRecordStorage,
        ),
        metricRecordAppendStore: new MetricRecordAppendStore(
          this.deps.repositories.metricRecordStorage,
        ),
        traceSummaryStore,
        originGateReactor,
        evaluationTriggerReactor,
        alertTriggerReactor,
        alertTriggerNotifyOutboxReactor,
        graphTriggerEvaluationOutboxReactor,
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
        suiteAnalyticsStore: new SuiteAnalyticsStore(
          this.deps.repositories.suiteAnalytics,
        ),
        suiteAnalyticsRollupAppendStore: new SuiteAnalyticsRollupAppendStore(
          this.deps.repositories.suiteAnalyticsRollup,
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
        simulationAnalyticsStore: new SimulationAnalyticsStore(
          this.deps.repositories.simulationAnalytics,
        ),
        simulationAnalyticsRollupAppendStore:
          new SimulationAnalyticsRollupAppendStore(
            this.deps.repositories.simulationAnalyticsRollup,
          ),
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
        experimentAnalyticsStore: new ExperimentAnalyticsStore(
          this.deps.repositories.experimentAnalytics,
        ),
        experimentAnalyticsRollupAppendStore:
          new ExperimentAnalyticsRollupAppendStore(
            this.deps.repositories.experimentAnalyticsRollup,
          ),
        esSync: createExperimentRunEsSyncReactor({
          project: this.deps.projects,
          repository: createElasticsearchBatchEvaluationRepository(),
        }),
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

export interface ProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
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
    return Array.from(def.foldProjections.values()).map(({ definition }) => ({
      projectionName: definition.name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      pauseKey: `${pipelineName}/projection/${definition.name}`,
    }));
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
