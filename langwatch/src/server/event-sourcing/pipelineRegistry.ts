import type { Redis, Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { BillingCheckpointService } from "../app-layer/billing/billingCheckpoint.service";
import type { EvaluationCostRecorder } from "../app-layer/evaluations/evaluation-cost.recorder";
import type { OrganizationService } from "../app-layer/organizations/organization.service";

import type { TraceSummaryData } from "../app-layer/traces/types";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import type { FoldProjectionStore } from "./projections/foldProjection.types";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import type { LogRecordStorageRepository } from "../app-layer/traces/repositories/log-record-storage.repository";
import type { MetricRecordStorageRepository } from "../app-layer/traces/repositories/metric-record-storage.repository";
import type { AnalyticsEvaluationFactsRepository } from "../app-layer/analytics/repositories/analytics-evaluation-facts.repository";
import type { AnalyticsTraceFactsRepository } from "../app-layer/analytics/repositories/analytics-trace-facts.repository";
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";

import { createEvaluationProcessingPipeline } from "./pipelines/evaluation-processing/pipeline";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import { createExperimentRunEsSyncReactor } from "./pipelines/experiment-run-processing/reactors/experimentRunEsSync.reactor";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { SIMULATION_PROJECTION_VERSIONS } from "./pipelines/simulation-processing/schemas/constants";
import { createSnapshotUpdateBroadcastReactor } from "./pipelines/simulation-processing/reactors/snapshotUpdateBroadcast";
import { createSuiteRunSyncReactor } from "./pipelines/simulation-processing/reactors/suiteRunSync.reactor";
import { createTraceMetricsSyncReactor } from "./pipelines/simulation-processing/reactors/traceMetricsSync.reactor";
import {
  ComputeRunMetricsCommand,
  COMPUTE_METRICS_RETRY_DELAY_MS,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import type { ComputeRunMetricsCommandData } from "./pipelines/simulation-processing/schemas/commands";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
import { createSuiteRunProcessingPipeline } from "./pipelines/suite-run-processing/pipeline";
import type { SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import { RedisCachedFoldStore } from "./projections/redisCachedFoldStore";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import { SUITE_RUN_PROJECTION_VERSIONS } from "./pipelines/suite-run-processing/schemas/constants";
import type { SuiteRunStateRepository } from "./pipelines/suite-run-processing/repositories/suiteRunState.repository";
import { createTraceProcessingPipeline } from "./pipelines/trace-processing/pipeline";
import { createSimulationMetricsSyncReactor } from "./pipelines/trace-processing/reactors/simulationMetricsSync.reactor";

import { createElasticsearchBatchEvaluationRepository } from "../evaluations-v3/repositories/elasticsearchBatchEvaluation.repository";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import { ReportUsageForMonthCommand } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import { AnalyticsEvaluationFactsStore } from "./pipelines/evaluation-processing/projections/analyticsEvaluationFacts.store";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import type { EvaluationEsSyncReactorDeps } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationEsSyncReactor } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import type { ExperimentRunStateData } from "./pipelines/experiment-run-processing/projections/experimentRunState.foldProjection";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import { LogRecordAppendStore } from "./pipelines/trace-processing/projections/logRecordStorage.store";
import { MetricRecordAppendStore } from "./pipelines/trace-processing/projections/metricRecordStorage.store";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import { AnalyticsTraceFactsStore } from "./pipelines/trace-processing/projections/analyticsTraceFacts.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createCustomEvaluationSyncReactor } from "./pipelines/trace-processing/reactors/customEvaluationSync.reactor";
import { createProjectMetadataReactor } from "./pipelines/trace-processing/reactors/projectMetadata.reactor";
import {
  createEvaluationTriggerReactor,
  createDeferredEvaluationHandler,
  makeDeferredJobId,
  DEFERRED_CHECK_DELAY_MS,
  type DeferredEvaluationPayload,
} from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import { createSpanStorageBroadcastReactor } from "./pipelines/trace-processing/reactors/spanStorageBroadcast.reactor";
import { createTraceUpdateBroadcastReactor } from "./pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";
import type { AppendStore } from "./projections/mapProjection.types";
import type { ClickHouseExperimentRunResultRecord } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

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
  experimentRunItemStorage: AppendStore<ClickHouseExperimentRunResultRecord>;
  analyticsTraceFacts?: AnalyticsTraceFactsRepository;
  analyticsEvaluationFacts?: AnalyticsEvaluationFactsRepository;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  repositories: PipelineRepositories;
  redis: Redis | Cluster;
  broadcast: BroadcastService;
  projects: ProjectService;
  monitors: MonitorService;
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

    const evalPipeline = this.registerEvaluationPipeline();
    const { pipeline: tracePipeline, traceSummaryStore, wireSimulationDeps } = this.registerTracePipeline(evalPipeline);
    const suiteRunPipeline = this.registerSuiteRunPipeline();
    const simulationPipeline = this.registerSimulationPipeline({ suiteRunPipeline, traceSummaryStore, wireSimulationDeps });

    const experimentRunPipeline = this.registerExperimentRunPipeline();
    const billingPipeline = this.registerBillingReportingPipeline();

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      suiteRuns: mapCommands(suiteRunPipeline.commands),
      billing: mapCommands(billingPipeline.commands),
    };
  }

  private registerEvaluationPipeline() {
    const executeEvaluationCommand = new ExecuteEvaluationCommand({
      monitors: this.deps.monitors,
      spanStorage: this.deps.traces.spans,
      traceEvents: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
      costRecorder: this.deps.costRecorder,
    });

    const esSyncReactor = createEvaluationEsSyncReactor(this.deps.esSync);

    const analyticsEvaluationFactsStore = this.deps.repositories.analyticsEvaluationFacts
      ? new AnalyticsEvaluationFactsStore(this.deps.repositories.analyticsEvaluationFacts)
      : undefined;

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        analyticsEvaluationFactsStore,
        executeEvaluationCommand,
        esSyncReactor,
      }),
    );
  }

  private registerTracePipeline(
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>,
  ) {
    const evalCommands = mapCommands(evalPipeline.commands);

    const traceSummaryStore = this.cached<TraceSummaryData>(
      new TraceSummaryStore(this.deps.repositories.traceSummaryFold),
      "trace_summaries",
    );

    // Late-bound reference to the trace pipeline's resolveOrigin command.
    // The reactor deps closure captures this; the actual dispatcher is set
    // after pipeline registration (same pattern as billing self-dispatch).
    let resolveOriginDispatcher: ((data: any) => Promise<void>) | null = null;

    // Late-bound reference to the deferred evaluation queue.
    // Set after pipeline registration, same pattern as resolveOriginDispatcher.
    let scheduleDeferredDispatcher: ((payload: DeferredEvaluationPayload) => Promise<void>) | null = null;

    const evaluationTriggerReactorDeps = {
      monitors: this.deps.monitors,
      evaluation: evalCommands.executeEvaluation,
      resolveOrigin: async (data: any) => {
        if (!resolveOriginDispatcher) {
          throw new Error("resolveOrigin dispatcher not yet initialized — pipeline registration order issue");
        }
        return resolveOriginDispatcher(data);
      },
      traceSummaryStore,
      scheduleDeferred: async (payload: DeferredEvaluationPayload) => {
        if (!scheduleDeferredDispatcher) {
          throw new Error("scheduleDeferred dispatcher not yet initialized — pipeline registration order issue");
        }
        return scheduleDeferredDispatcher(payload);
      },
    };

    const evaluationTriggerReactor = createEvaluationTriggerReactor(evaluationTriggerReactorDeps);

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
    });

    // Late-bound reference for simulation metrics sync reactor.
    // The simulation pipeline is registered after the trace pipeline,
    // so computeRunMetrics is wired after simulation pipeline registration.
    let simComputeRunMetrics: ((data: any) => Promise<void>) | null = null;

    const simulationMetricsSyncReactor = createSimulationMetricsSyncReactor({
      computeRunMetrics: async (data) => {
        if (!simComputeRunMetrics) {
          logger.warn("simulation computeRunMetrics not yet initialized, skipping");
          return;
        }
        return simComputeRunMetrics(data);
      },
    });

    const analyticsTraceFactsStore = this.deps.repositories.analyticsTraceFacts
      ? new AnalyticsTraceFactsStore(this.deps.repositories.analyticsTraceFacts)
      : undefined;

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        logRecordAppendStore: new LogRecordAppendStore(this.deps.repositories.logRecordStorage),
        metricRecordAppendStore: new MetricRecordAppendStore(this.deps.repositories.metricRecordStorage),
        traceSummaryStore,
        analyticsTraceFactsStore,
        evaluationTriggerReactor,
        customEvaluationSyncReactor,
        traceUpdateBroadcastReactor,
        projectMetadataReactor,
        simulationMetricsSyncReactor,
        spanStorageBroadcastReactor,
      }),
    );

    // Wire the late-bound resolveOrigin dispatcher now that the pipeline is registered
    const traceCommands = mapCommands(tracePipeline.commands);
    resolveOriginDispatcher = traceCommands.resolveOrigin;

    // Wire the deferred evaluation queue (BullMQ-backed, survives process restart)
    const deferredHandler = createDeferredEvaluationHandler(evaluationTriggerReactorDeps);
    const deferredEvalQueue = tracePipeline.service.registerJob<DeferredEvaluationPayload>({
      name: "deferredEvaluation",
      process: deferredHandler,
      delay: DEFERRED_CHECK_DELAY_MS,
      deduplication: {
        makeId: makeDeferredJobId,
        extend: false,  // Don't reset the 5-min timer on new spans
        replace: false,
      },
      spanAttributes: (payload) => ({
        "deferred.tenant_id": payload.tenantId,
        "deferred.trace_id": payload.traceId,
      }),
    });

    if (deferredEvalQueue) {
      scheduleDeferredDispatcher = (payload) => deferredEvalQueue.send(payload);
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout (best-effort)
      const pendingDeferredChecks = new Map<string, ReturnType<typeof setTimeout>>();
      scheduleDeferredDispatcher = async (payload: DeferredEvaluationPayload) => {
        const dedupKey = makeDeferredJobId(payload);
        if (pendingDeferredChecks.has(dedupKey)) return;
        const handler = createDeferredEvaluationHandler(evaluationTriggerReactorDeps);
        const timer = setTimeout(async () => {
          pendingDeferredChecks.delete(dedupKey);
          try {
            await handler(payload);
          } catch (error) {
            logger.error(
              { tenantId: payload.tenantId, traceId: payload.traceId, error },
              "Deferred evaluation check failed",
            );
          }
        }, DEFERRED_CHECK_DELAY_MS);
        if (typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
        pendingDeferredChecks.set(dedupKey, timer);
      };
    }

    return {
      pipeline: tracePipeline,
      traceSummaryStore,
      /**
       * Wires late-bound simulation computeRunMetrics into the trace-side
       * simulationMetricsSync reactor. Called after the simulation
       * pipeline is registered.
       */
      wireSimulationDeps: (deps: {
        computeRunMetrics: (data: any) => Promise<void>;
      }) => {
        simComputeRunMetrics = deps.computeRunMetrics;
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

  private registerSimulationPipeline({ suiteRunPipeline, traceSummaryStore, wireSimulationDeps }: {
    suiteRunPipeline: ReturnType<PipelineRegistry["registerSuiteRunPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    wireSimulationDeps: ReturnType<PipelineRegistry["registerTracePipeline"]>["wireSimulationDeps"];
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

    const suiteRunCommands = mapCommands(suiteRunPipeline.commands);
    const suiteRunSyncReactor = createSuiteRunSyncReactor({
      recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
      completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
    });

    // Late-bound: computeRunMetrics dispatches back to self (same pipeline)
    let selfComputeRunMetrics: ((data: any) => Promise<void>) | null = null;

    // Late-bound: deferred retry dispatcher
    let scheduleRetryDispatcher: ((payload: ComputeRunMetricsCommandData) => Promise<void>) | null = null;

    const computeRunMetricsCommand = new ComputeRunMetricsCommand({
      traceSummaryStore,
      scheduleRetry: async (payload) => {
        if (!scheduleRetryDispatcher) {
          logger.warn("scheduleRetry dispatcher not yet initialized, skipping");
          return;
        }
        return scheduleRetryDispatcher(payload);
      },
    });

    const traceMetricsSyncReactor = createTraceMetricsSyncReactor({
      computeRunMetrics: async (data: any) => {
        if (!selfComputeRunMetrics) {
          logger.warn("computeRunMetrics self-dispatcher not yet initialized, skipping");
          return;
        }
        return selfComputeRunMetrics(data);
      },
    });

    const simulationPipeline = this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        snapshotUpdateBroadcastReactor,
        suiteRunSyncReactor,
        traceMetricsSyncReactor,
        computeRunMetricsCommand,
      }),
    );

    // Wire late-bound self-dispatcher
    const simCommands = mapCommands(simulationPipeline.commands);
    selfComputeRunMetrics = simCommands.computeRunMetrics;

    // Wire deferred retry job
    const retryJobId = (payload: ComputeRunMetricsCommandData) =>
      `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`;

    const retryQueue = simulationPipeline.service.registerJob<ComputeRunMetricsCommandData>({
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
      scheduleRetryDispatcher = (payload) => retryQueue.send(payload);
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout
      scheduleRetryDispatcher = async (payload: ComputeRunMetricsCommandData) => {
        const timer = setTimeout(async () => {
          try {
            await simCommands.computeRunMetrics(payload);
          } catch (error) {
            logger.error(
              { tenantId: payload.tenantId, scenarioRunId: payload.scenarioRunId, traceId: payload.traceId, error },
              "Deferred compute metrics retry failed",
            );
          }
        }, COMPUTE_METRICS_RETRY_DELAY_MS);
        if (typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
      };
    }

    // Wire the trace-side simulationMetricsSync reactor's late-bound deps
    wireSimulationDeps({
      computeRunMetrics: simCommands.computeRunMetrics,
    });

    return simulationPipeline;
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

  private registerExperimentRunPipeline() {
    const experimentRunStore = this.cached<ExperimentRunStateData>(
      createExperimentRunStateFoldStore(this.deps.repositories.experimentRunState),
      "experiment_runs",
    );

    return this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore: experimentRunStore,
        experimentRunItemAppendStore: this.deps.repositories.experimentRunItemStorage,
        esSync: createExperimentRunEsSyncReactor({
          project: this.deps.projects,
          repository: createElasticsearchBatchEvaluationRepository(),
        }),
      }),
    );
  }
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;
