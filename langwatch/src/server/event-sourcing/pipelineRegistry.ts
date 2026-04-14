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
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";

import { createEvaluationProcessingPipeline } from "./pipelines/evaluation-processing/pipeline";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import { createExperimentRunEsSyncReactor } from "./pipelines/experiment-run-processing/reactors/experimentRunEsSync.reactor";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import { SimulationRunStateFoldProjection, type SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { SIMULATION_PROJECTION_VERSIONS } from "./pipelines/simulation-processing/schemas/constants";
import { createSnapshotUpdateBroadcastReactor } from "./pipelines/simulation-processing/reactors/snapshotUpdateBroadcast";
import { createCancellationBroadcastReactor } from "./pipelines/simulation-processing/reactors/cancellationBroadcast.reactor";
import { createScenarioExecutionReactor } from "./pipelines/simulation-processing/reactors/scenarioExecution.reactor";
import type { ScenarioExecutionReactorHandle } from "./pipelines/simulation-processing/reactors/scenarioExecution.reactor";
import { createSuiteRunSyncReactor } from "./pipelines/simulation-processing/reactors/suiteRunSync.reactor";
import { createTraceMetricsSyncReactor } from "./pipelines/simulation-processing/reactors/traceMetricsSync.reactor";
import {
  ComputeRunMetricsCommand,
  COMPUTE_METRICS_RETRY_DELAY_MS,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import type { ComputeRunMetricsCommandData } from "./pipelines/simulation-processing/schemas/commands";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
import { createSuiteRunProcessingPipeline } from "./pipelines/suite-run-processing/pipeline";
import { SuiteRunStateFoldProjection, type SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
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
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import { EvaluationRunFoldProjection } from "./pipelines/evaluation-processing/projections/evaluationRun.foldProjection";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import type { EvaluationEsSyncReactorDeps } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationEsSyncReactor } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import { ExperimentRunStateFoldProjection, type ExperimentRunStateData } from "./pipelines/experiment-run-processing/projections/experimentRunState.foldProjection";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import { LogRecordAppendStore } from "./pipelines/trace-processing/projections/logRecordStorage.store";
import { MetricRecordAppendStore } from "./pipelines/trace-processing/projections/metricRecordStorage.store";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import { TraceSummaryFoldProjection } from "./pipelines/trace-processing/projections/traceSummary.foldProjection";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createCustomEvaluationSyncReactor } from "./pipelines/trace-processing/reactors/customEvaluationSync.reactor";
import { createProjectMetadataReactor } from "./pipelines/trace-processing/reactors/projectMetadata.reactor";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import {
  createOriginGateReactor,
  createDeferredOriginHandler,
  makeDeferredJobId,
  DEFERRED_CHECK_DELAY_MS,
  type DeferredOriginPayload,
} from "./pipelines/trace-processing/reactors/originGate.reactor";
import { createSpanStorageBroadcastReactor } from "./pipelines/trace-processing/reactors/spanStorageBroadcast.reactor";
import { createTraceUpdateBroadcastReactor } from "./pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";
import type { AppendStore } from "./projections/mapProjection.types";
import type { ClickHouseExperimentRunResultRecord } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection";
import type { RegisteredFoldProjection } from "./replay/types";
import type { EvaluationRunRepository } from "../app-layer/evaluations/repositories/evaluation-run.repository";
import { projectDailySdkUsageProjection } from "./projections/global/projectDailySdkUsage.foldProjection";

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
    const { pipeline: simulationPipeline, scenarioExecutionHandle } = this.registerSimulationPipeline({ suiteRunPipeline, traceSummaryStore, wireSimulationDeps });

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
      /** Late-bind the execution pool for scenario execution reactor. */
      scenarioExecutionHandle,
    };
  }

  private registerEvaluationPipeline() {
    const executeEvaluationCommand = new ExecuteEvaluationCommand({
      monitors: this.deps.monitors,
      spanStorage: this.deps.traces.spans,
      traceEvents: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
      costRecorder: this.deps.costRecorder,
      azureSafetyEnvResolver: getAzureSafetyEnvFromProject,
    });

    const esSyncReactor = createEvaluationEsSyncReactor(this.deps.esSync);

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
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

    // Late-bound reference to the deferred origin resolution queue.
    // Set after pipeline registration, same pattern as resolveOriginDispatcher.
    let scheduleDeferredDispatcher: ((payload: DeferredOriginPayload) => Promise<void>) | null = null;

    const originGateReactor = createOriginGateReactor({
      scheduleDeferred: async (payload: DeferredOriginPayload) => {
        if (!scheduleDeferredDispatcher) {
          throw new Error("scheduleDeferred dispatcher not yet initialized — pipeline registration order issue");
        }
        return scheduleDeferredDispatcher(payload);
      },
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

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        logRecordAppendStore: new LogRecordAppendStore(this.deps.repositories.logRecordStorage),
        metricRecordAppendStore: new MetricRecordAppendStore(this.deps.repositories.metricRecordStorage),
        traceSummaryStore,
        originGateReactor,
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

    // Wire the deferred origin resolution queue (BullMQ-backed, survives process restart).
    // After 5 min, dispatches resolveOrigin command → OriginResolvedEvent → fold → reactor.
    const deferredOriginHandler = createDeferredOriginHandler(async (data) => {
      if (!resolveOriginDispatcher) {
        throw new Error("resolveOrigin dispatcher not yet initialized — pipeline registration order issue");
      }
      return resolveOriginDispatcher(data);
    });
    const deferredOriginQueue = tracePipeline.service.registerJob<DeferredOriginPayload>({
      name: "deferredOriginResolution",
      process: deferredOriginHandler,
      delay: DEFERRED_CHECK_DELAY_MS,
      deduplication: {
        makeId: makeDeferredJobId,
        ttlMs: DEFERRED_CHECK_DELAY_MS + 60_000, // 6 min — covers the 5-min delay + buffer
        extend: false,  // Don't reset the 5-min timer on new spans
        replace: false,  // Don't update payload (same trace, same data)
      },
      groupKeyFn: (p) => p.traceId,  // Per-trace parallelism (framework prepends tenantId)
      spanAttributes: (payload) => ({
        "deferred.tenant_id": payload.tenantId,
        "deferred.trace_id": payload.traceId,
      }),
    });

    if (deferredOriginQueue) {
      scheduleDeferredDispatcher = (payload) => deferredOriginQueue.send(payload);
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout (best-effort)
      const pendingDeferredChecks = new Map<string, ReturnType<typeof setTimeout>>();
      scheduleDeferredDispatcher = async (payload: DeferredOriginPayload) => {
        const dedupKey = makeDeferredJobId(payload);
        if (pendingDeferredChecks.has(dedupKey)) return;
        const handler = createDeferredOriginHandler(async (data) => {
          if (!resolveOriginDispatcher) {
            throw new Error("resolveOrigin dispatcher not yet initialized");
          }
          return resolveOriginDispatcher(data);
        });
        const timer = setTimeout(async () => {
          pendingDeferredChecks.delete(dedupKey);
          try {
            await handler(payload);
          } catch (error) {
            logger.error(
              { tenantId: payload.tenantId, traceId: payload.traceId, error },
              "Deferred origin resolution failed",
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

    const cancellationBroadcastReactor = createCancellationBroadcastReactor({
      publisher: this.deps.eventSourcing.redisConnection ?? null,
    });

    const scenarioExecutionHandle = createScenarioExecutionReactor();

    const suiteRunCommands = mapCommands(suiteRunPipeline.commands);
    const suiteRunSyncReactor = createSuiteRunSyncReactor({
      recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
      completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
    });

    // Late-bound: computeRunMetrics dispatches back to self (same pipeline)
    let selfComputeRunMetrics: ((data: ComputeRunMetricsCommandData) => Promise<void>) | null = null;

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
        cancellationBroadcastReactor,
        scenarioExecutionReactor: scenarioExecutionHandle.reactor,
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

/**
 * Repositories needed exclusively for fold projection construction.
 * Used by `buildFoldProjections()` for replay — no Redis, no queues.
 */
export interface FoldProjectionRepositories {
  traceSummaryFold: TraceSummaryRepository;
  evaluationRun: EvaluationRunRepository;
  experimentRunState: ExperimentRunStateRepository;
  simulationRunState: SimulationRunStateRepository;
  suiteRunState: SuiteRunStateRepository;
}

/**
 * Constructs fold projections with raw CH stores (no Redis cache).
 *
 * This is the **single source of truth** for which fold projections exist.
 * When adding a new fold projection to registerAll(), add it here too.
 */
export function buildFoldProjections(
  repos: FoldProjectionRepositories,
): RegisteredFoldProjection[] {
  const results: RegisteredFoldProjection[] = [];

  // traceSummary
  const traceSummaryDef = new TraceSummaryFoldProjection({
    store: new TraceSummaryStore(repos.traceSummaryFold),
  });
  results.push({
    projectionName: traceSummaryDef.name,
    pipelineName: "trace_processing",
    aggregateType: "trace",
    source: "pipeline",
    definition: traceSummaryDef,
    pauseKey: `trace_processing/projection/${traceSummaryDef.name}`,
    targetTable: "trace_summaries",
  });

  // evaluationRun
  const evalRunDef = new EvaluationRunFoldProjection({
    store: new EvaluationRunStore(repos.evaluationRun),
  });
  results.push({
    projectionName: evalRunDef.name,
    pipelineName: "evaluation_processing",
    aggregateType: "evaluation",
    source: "pipeline",
    definition: evalRunDef,
    pauseKey: `evaluation_processing/projection/${evalRunDef.name}`,
    targetTable: "evaluation_runs",
  });

  // experimentRunState
  const expRunDef = new ExperimentRunStateFoldProjection({
    store: createExperimentRunStateFoldStore(repos.experimentRunState),
  });
  results.push({
    projectionName: expRunDef.name,
    pipelineName: "experiment_run_processing",
    aggregateType: "experiment_run",
    source: "pipeline",
    definition: expRunDef,
    pauseKey: `experiment_run_processing/projection/${expRunDef.name}`,
    targetTable: "experiment_runs",
  });

  // simulationRunState
  const simRunDef = new SimulationRunStateFoldProjection({
    store: new RepositoryFoldStore(repos.simulationRunState, SIMULATION_PROJECTION_VERSIONS.RUN_STATE),
  });
  results.push({
    projectionName: simRunDef.name,
    pipelineName: "simulation_processing",
    aggregateType: "simulation_run",
    source: "pipeline",
    definition: simRunDef,
    pauseKey: `simulation_processing/projection/${simRunDef.name}`,
    targetTable: "simulation_runs",
  });

  // suiteRunState
  const suiteRunDef = new SuiteRunStateFoldProjection({
    store: new RepositoryFoldStore(repos.suiteRunState, SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE),
  });
  results.push({
    projectionName: suiteRunDef.name,
    pipelineName: "suite_run_processing",
    aggregateType: "suite_run",
    source: "pipeline",
    definition: suiteRunDef,
    pauseKey: `suite_run_processing/projection/${suiteRunDef.name}`,
    targetTable: "suite_runs",
  });

  // projectDailySdkUsage (global — store baked in, Prisma-backed)
  results.push({
    projectionName: projectDailySdkUsageProjection.name,
    pipelineName: "global_projections",
    aggregateType: "global",
    source: "global",
    definition: projectDailySdkUsageProjection,
    pauseKey: `global_projections/projection/${projectDailySdkUsageProjection.name}`,
  });

  return results;
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;

export interface ProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  targetTable?: string;
}

const PROJECTION_METADATA: ProjectionMetadata[] = [
  {
    projectionName: "traceSummary",
    pipelineName: "trace_processing",
    aggregateType: "trace",
    source: "pipeline",
    pauseKey: "trace_processing/projection/traceSummary",
    targetTable: "trace_summaries",
  },
  {
    projectionName: "evaluationRun",
    pipelineName: "evaluation_processing",
    aggregateType: "evaluation",
    source: "pipeline",
    pauseKey: "evaluation_processing/projection/evaluationRun",
    targetTable: "evaluation_runs",
  },
  {
    projectionName: "experimentRunState",
    pipelineName: "experiment_run_processing",
    aggregateType: "experiment_run",
    source: "pipeline",
    pauseKey: "experiment_run_processing/projection/experimentRunState",
    targetTable: "experiment_runs",
  },
  {
    projectionName: "simulationRunState",
    pipelineName: "simulation_processing",
    aggregateType: "simulation_run",
    source: "pipeline",
    pauseKey: "simulation_processing/projection/simulationRunState",
    targetTable: "simulation_runs",
  },
  {
    projectionName: "suiteRunState",
    pipelineName: "suite_run_processing",
    aggregateType: "suite_run",
    source: "pipeline",
    pauseKey: "suite_run_processing/projection/suiteRunState",
    targetTable: "suite_runs",
  },
  {
    projectionName: projectDailySdkUsageProjection.name,
    pipelineName: "global_projections",
    aggregateType: "global",
    source: "global",
    pauseKey: `global_projections/projection/${projectDailySdkUsageProjection.name}`,
  },
];

export function getProjectionMetadata(): ProjectionMetadata[] {
  return PROJECTION_METADATA;
}

export interface ReactorMetadata {
  reactorName: string;
  pipelineName: string;
  aggregateType: string;
  afterProjection: string;
}

const REACTOR_METADATA: ReactorMetadata[] = [
  // trace_processing reactors (after traceSummary fold)
  { reactorName: "originGate", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "evaluationTrigger", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "customEvaluationSync", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "traceUpdateBroadcast", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "projectMetadata", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "simulationMetricsSync", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "traceSummary" },
  { reactorName: "spanStorageBroadcast", pipelineName: "trace_processing", aggregateType: "trace", afterProjection: "spanStorage" },
  // evaluation_processing reactors
  { reactorName: "evaluationEsSync", pipelineName: "evaluation_processing", aggregateType: "evaluation", afterProjection: "evaluationRun" },
  // experiment_run_processing reactors
  { reactorName: "experimentRunEsSync", pipelineName: "experiment_run_processing", aggregateType: "experiment_run", afterProjection: "experimentRunState" },
  // simulation_processing reactors
  { reactorName: "snapshotUpdateBroadcast", pipelineName: "simulation_processing", aggregateType: "simulation_run", afterProjection: "simulationRunState" },
  { reactorName: "cancellationBroadcast", pipelineName: "simulation_processing", aggregateType: "simulation_run", afterProjection: "simulationRunState" },
  { reactorName: "suiteRunSync", pipelineName: "simulation_processing", aggregateType: "simulation_run", afterProjection: "simulationRunState" },
  { reactorName: "traceMetricsSync", pipelineName: "simulation_processing", aggregateType: "simulation_run", afterProjection: "simulationRunState" },
  { reactorName: "scenarioExecution", pipelineName: "simulation_processing", aggregateType: "simulation_run", afterProjection: "simulationRunState" },
];

export function getReactorMetadata(): ReactorMetadata[] {
  return REACTOR_METADATA;
}

const noOpStore: FoldProjectionStore<any> = {
  store: async () => {},
  storeBatch: async () => {},
  get: async () => null,
};

export interface DejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

let dejaViewProjectionsCache: DejaViewProjection[] | null = null;

export function getDejaViewProjections(): DejaViewProjection[] {
  if (dejaViewProjectionsCache) return dejaViewProjectionsCache;

  const projections: DejaViewProjection[] = [];

  const traceSummary = new TraceSummaryFoldProjection({ store: noOpStore as any });
  projections.push({
    projectionName: traceSummary.name,
    eventTypes: traceSummary.eventTypes,
    init: () => traceSummary.init(),
    apply: (state, event) => traceSummary.apply(state as any, event),
  });

  const evalRun = new EvaluationRunFoldProjection({ store: noOpStore as any });
  projections.push({
    projectionName: evalRun.name,
    eventTypes: evalRun.eventTypes,
    init: () => evalRun.init(),
    apply: (state, event) => evalRun.apply(state as any, event),
  });

  const expRun = new ExperimentRunStateFoldProjection({ store: noOpStore as any });
  projections.push({
    projectionName: expRun.name,
    eventTypes: expRun.eventTypes,
    init: () => expRun.init(),
    apply: (state, event) => expRun.apply(state as any, event),
  });

  const simRun = new SimulationRunStateFoldProjection({ store: noOpStore as any });
  projections.push({
    projectionName: simRun.name,
    eventTypes: simRun.eventTypes,
    init: () => simRun.init(),
    apply: (state, event) => simRun.apply(state as any, event),
  });

  const suiteRun = new SuiteRunStateFoldProjection({ store: noOpStore as any });
  projections.push({
    projectionName: suiteRun.name,
    eventTypes: suiteRun.eventTypes,
    init: () => suiteRun.init(),
    apply: (state, event) => suiteRun.apply(state as any, event),
  });

  dejaViewProjectionsCache = projections;
  return projections;
}
