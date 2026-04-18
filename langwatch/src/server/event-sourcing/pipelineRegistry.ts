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
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
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
import type { SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import { RedisCachedFoldStore } from "./projections/redisCachedFoldStore";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import { SUITE_RUN_PROJECTION_VERSIONS } from "./pipelines/suite-run-processing/schemas/constants";
import type { SuiteRunStateRepository } from "./pipelines/suite-run-processing/repositories/suiteRunState.repository";
import { createTraceProcessingPipeline } from "./pipelines/trace-processing/pipeline";
import { createSimulationMetricsSyncReactor } from "./pipelines/trace-processing/reactors/simulationMetricsSync.reactor";
import { createExperimentMetricsSyncReactor } from "./pipelines/trace-processing/reactors/experimentMetricsSync.reactor";
import type { ComputeExperimentRunMetricsCommandData } from "./pipelines/experiment-run-processing/schemas/commands";

import { createElasticsearchBatchEvaluationRepository } from "../evaluations-v3/repositories/elasticsearchBatchEvaluation.repository";
import { Deferred, type CommandDispatcher } from "./deferred";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import { ReportUsageForMonthCommand } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
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
import type { ResolveOriginCommandData } from "./pipelines/trace-processing/schemas/commands";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

/**
 * Creates an in-memory setTimeout-based fallback for deferred job processing.
 * Used when the event-sourcing queue is unavailable (e.g. no Redis).
 */
function createInMemoryDeferredFallback<P>({ makeId, delayMs, process, logContext, errorMessage }: {
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
    const { pipeline: tracePipeline, traceSummaryStore, simComputeRunMetrics, wireExperimentDeps } = this.registerTracePipeline(evalPipeline);
    const suiteRunPipeline = this.registerSuiteRunPipeline();
    const { pipeline: simulationPipeline, scenarioExecutionHandle } = this.registerSimulationPipeline({ suiteRunPipeline, traceSummaryStore, simComputeRunMetrics });

    const experimentRunPipeline = this.registerExperimentRunPipeline({ wireExperimentDeps });
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

    // Deferred dispatchers — resolved after pipeline registration.
    const resolveOrigin = new Deferred<CommandDispatcher<ResolveOriginCommandData>>("resolveOrigin");
    const scheduleDeferred = new Deferred<(payload: DeferredOriginPayload) => Promise<void>>("scheduleDeferred");
    const simComputeRunMetrics = new Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>("simComputeRunMetrics");

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
    });

    const simulationMetricsSyncReactor = createSimulationMetricsSyncReactor({
      computeRunMetrics: simComputeRunMetrics.fn,
    });

    // Late-bound reference for experiment metrics sync reactor.
    // The experiment pipeline is registered after the trace pipeline,
    // so computeExperimentRunMetrics is wired after experiment pipeline registration.
    let expComputeRunMetrics: ((data: ComputeExperimentRunMetricsCommandData) => Promise<void>) | null = null;
    let expLookupExperimentId: ((tenantId: string, runId: string) => Promise<string | null>) | null = null;

    const experimentMetricsSyncReactor = createExperimentMetricsSyncReactor({
      computeExperimentRunMetrics: async (data) => {
        if (!expComputeRunMetrics) {
          logger.warn("experiment computeExperimentRunMetrics not yet initialized, skipping");
          return;
        }
        return expComputeRunMetrics(data);
      },
      lookupExperimentId: async (tenantId, runId) => {
        if (!expLookupExperimentId) {
          logger.warn("experiment lookupExperimentId not yet initialized, skipping");
          return null;
        }
        return expLookupExperimentId(tenantId, runId);
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
        experimentMetricsSyncReactor,
        spanStorageBroadcastReactor,
      }),
    );

    // Resolve self-referencing command now that the pipeline is registered
    const traceCommands = mapCommands(tracePipeline.commands);
    resolveOrigin.resolve(traceCommands.resolveOrigin);

    // Wire the deferred origin resolution queue (BullMQ-backed, survives process restart).
    // After 5 min, dispatches resolveOrigin command → OriginResolvedEvent → fold → reactor.
    const deferredOriginHandler = createDeferredOriginHandler(resolveOrigin.fn);
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
        computeExperimentRunMetrics: (data: ComputeExperimentRunMetricsCommandData) => Promise<void>;
        lookupExperimentId: (tenantId: string, runId: string) => Promise<string | null>;
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

  private registerSimulationPipeline({ suiteRunPipeline, traceSummaryStore, simComputeRunMetrics }: {
    suiteRunPipeline: ReturnType<PipelineRegistry["registerSuiteRunPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    simComputeRunMetrics: Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>;
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
    const selfComputeRunMetrics = new Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>("selfComputeRunMetrics");
    const scheduleRetry = new Deferred<(payload: ComputeRunMetricsCommandData) => Promise<void>>("scheduleRetry");

    const computeRunMetricsCommand = new ComputeRunMetricsCommand({
      traceSummaryStore,
      scheduleRetry: scheduleRetry.fn,
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
      scheduleRetry.resolve((payload) => retryQueue.send(payload));
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout
      scheduleRetry.resolve(
        createInMemoryDeferredFallback({
          delayMs: COMPUTE_METRICS_RETRY_DELAY_MS,
          process: (payload) => simCommands.computeRunMetrics(payload),
          logContext: (p) => ({ tenantId: p.tenantId, scenarioRunId: p.scenarioRunId, traceId: p.traceId }),
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

  private registerExperimentRunPipeline({ wireExperimentDeps }: {
    wireExperimentDeps: ReturnType<PipelineRegistry["registerTracePipeline"]>["wireExperimentDeps"];
  }) {
    const experimentRunStore = this.cached<ExperimentRunStateData>(
      createExperimentRunStateFoldStore(this.deps.repositories.experimentRunState),
      "experiment_runs",
    );

    const experimentRunPipeline = this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore: experimentRunStore,
        experimentRunItemAppendStore: this.deps.repositories.experimentRunItemStorage,
        esSync: createExperimentRunEsSyncReactor({
          project: this.deps.projects,
          repository: createElasticsearchBatchEvaluationRepository(),
        }),
      }),
    );

    // Wire the trace-side experimentMetricsSync reactor's late-bound deps
    const expCommands = mapCommands(experimentRunPipeline.commands);

    // Create the experimentId lookup function using the experiment run ClickHouse repository
    const lookupExperimentId = async (tenantId: string, runId: string): Promise<string | null> => {
      try {
        const { getClickHouseClientForProject } = await import("../clickhouse/clickhouseClient");
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

import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import { getApp } from "../app-layer/app";

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

function getDefinitions(): ReadonlyArray<StaticPipelineDefinition<any, any, any>> {
  return getApp().eventSourcing?.definitions ?? [];
}

export function getProjectionMetadata(): ProjectionMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    const folds = Array.from(def.foldProjections.values()).map(({ definition }) => ({
      projectionName: definition.name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      pauseKey: `${pipelineName}/projection/${definition.name}`,
      kind: "fold" as const,
    }));
    const maps = Array.from(def.mapProjections.values()).map(({ definition }) => ({
      projectionName: definition.name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      pauseKey: `${pipelineName}/projection/${definition.name}`,
      kind: "map" as const,
    }));
    return [...folds, ...maps];
  });
}

export function getReactorMetadata(): ReactorMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.foldReactors.values()).map(({ projectionName, definition }) => ({
      reactorName: definition.name,
      pipelineName,
      aggregateType,
      afterProjection: projectionName,
    }));
  });
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
