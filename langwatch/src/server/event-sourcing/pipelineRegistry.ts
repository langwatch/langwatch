import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import { LogRecordStorageClickHouseRepository } from "../app-layer/traces/repositories/log-record-storage.clickhouse.repository";
import { NullLogRecordStorageRepository } from "../app-layer/traces/repositories/log-record-storage.repository";
import { MetricRecordStorageClickHouseRepository } from "../app-layer/traces/repositories/metric-record-storage.clickhouse.repository";
import { NullMetricRecordStorageRepository } from "../app-layer/traces/repositories/metric-record-storage.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import { createElasticsearchBatchEvaluationRepository } from "../evaluations-v3/repositories/elasticsearchBatchEvaluation.repository";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import { createReportUsageForMonthCommandClass } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
import { createExecuteEvaluationCommandClass } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import { createEvaluationProcessingPipeline } from "./pipelines/evaluation-processing/pipeline";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import type { EvaluationEsSyncReactorDeps } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationEsSyncReactor } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import { createExperimentRunEsSyncReactor } from "./pipelines/experiment-run-processing/reactors/experimentRunEsSync.reactor";
import {
  ExperimentRunStateRepositoryClickHouse,
  ExperimentRunStateRepositoryMemory,
} from "./pipelines/experiment-run-processing/repositories";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import { createSimulationRunStateFoldStore } from "./pipelines/simulation-processing/projections/simulationRunState.store";
import { createSnapshotUpdateBroadcastReactor } from "./pipelines/simulation-processing/reactors/snapshotUpdateBroadcast";
import {
  SimulationRunStateRepositoryClickHouse,
  SimulationRunStateRepositoryMemory,
} from "./pipelines/simulation-processing/repositories";
import { createTraceProcessingPipeline } from "./pipelines/trace-processing/pipeline";
import { LogRecordAppendStore } from "./pipelines/trace-processing/projections/logRecordStorage.store";
import { MetricRecordAppendStore } from "./pipelines/trace-processing/projections/metricRecordStorage.store";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import { createSatisfactionScoreReactor } from "./pipelines/trace-processing/reactors/satisfactionScore.reactor";
import { createSpanStorageBroadcastReactor } from "./pipelines/trace-processing/reactors/spanStorageBroadcast.reactor";
import { createTraceUpdateBroadcastReactor } from "./pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  prisma: PrismaClient;
  clickhouse: ClickHouseClient | null;
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
  esSync: EvaluationEsSyncReactorDeps;
  usageReportingService?: UsageReportingService;
}

/**
 * Composition root for all event-sourcing pipelines.
 *
 * Creates store adapters, builds reactors and command classes, then registers
 * all pipelines with the EventSourcing runtime. Pipelines receive only
 * store interfaces and pre-built artifacts — never raw deps like prisma.
 */
export class PipelineRegistry {
  constructor(private readonly deps: PipelineRegistryDeps) {}

  registerAll() {
    const evalPipeline = this.registerEvaluationPipeline();
    const tracePipeline = this.registerTracePipeline(evalPipeline);
    const experimentRunPipeline = this.registerExperimentRunPipeline();
    const simulationPipeline = this.registerSimulationPipeline();
    const billingPipeline = this.registerBillingReportingPipeline();

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      billing: mapCommands(billingPipeline.commands),
    };
  }

  private registerEvaluationPipeline() {
    const ExecuteEvaluationCommand = createExecuteEvaluationCommandClass({
      prisma: this.deps.prisma,
      spanStorage: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
    });

    const esSyncReactor = createEvaluationEsSyncReactor(this.deps.esSync);

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        ExecuteEvaluationCommand,
        esSyncReactor,
      }),
    );
  }

  private registerTracePipeline(
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>,
  ) {
    const evaluationTriggerReactor = createEvaluationTriggerReactor({
      monitors: this.deps.monitors,
      evaluation: mapCommands(evalPipeline.commands).executeEvaluation,
    });

    const traceUpdateBroadcastReactor = createTraceUpdateBroadcastReactor({
      broadcast: this.deps.broadcast,
      hasRedis: !!this.deps.eventSourcing.redisConnection,
    });

    const spanStorageBroadcastReactor = createSpanStorageBroadcastReactor({
      broadcast: this.deps.broadcast,
      hasRedis: !!this.deps.eventSourcing.redisConnection,
    });

    // Mutable ref: the reactor closure captures this, we fill it after registration
    const satisfactionCommandRef: {
      dispatch: AppCommands["traces"]["assignSatisfactionScore"] | null;
    } = { dispatch: null };

    const satisfactionScoreReactor = createSatisfactionScoreReactor({
      assignSatisfactionScore: (data) => {
        if (!satisfactionCommandRef.dispatch) {
          throw new Error(
            "assignSatisfactionScore command not yet wired — pipeline not registered",
          );
        }
        return satisfactionCommandRef.dispatch(data);
      },
      nlpServiceUrl: process.env.LANGWATCH_NLP_SERVICE,
    });

    if (!this.deps.clickhouse) {
      logger.warn(
        "ClickHouse client not provided, log and metric record writes will be no-ops using NullRepository implementations",
      );
    }

    const logRecordRepo = this.deps.clickhouse
      ? new LogRecordStorageClickHouseRepository(this.deps.clickhouse)
      : new NullLogRecordStorageRepository();
    const metricRecordRepo = this.deps.clickhouse
      ? new MetricRecordStorageClickHouseRepository(this.deps.clickhouse)
      : new NullMetricRecordStorageRepository();

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        logRecordAppendStore: new LogRecordAppendStore(logRecordRepo),
        metricRecordAppendStore: new MetricRecordAppendStore(metricRecordRepo),
        traceSummaryStore: new TraceSummaryStore(
          this.deps.traces.summary.repository,
        ),
        evaluationTriggerReactor,
        traceUpdateBroadcastReactor,
        satisfactionScoreReactor,
        spanStorageBroadcastReactor,
      }),
    );

    // Complete the wiring now that the pipeline is registered
    satisfactionCommandRef.dispatch = mapCommands(
      tracePipeline.commands,
    ).assignSatisfactionScore;

    return tracePipeline;
  }

  private registerSimulationPipeline() {
    const repository = this.deps.clickhouse
      ? new SimulationRunStateRepositoryClickHouse(this.deps.clickhouse)
      : new SimulationRunStateRepositoryMemory();
    const simulationRunStore = createSimulationRunStateFoldStore(repository);
    const snapshotUpdateBroadcastReactor = createSnapshotUpdateBroadcastReactor(
      {
        broadcast: this.deps.broadcast,
        hasRedis: !!this.deps.eventSourcing.redisConnection,
      },
    );

    return this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        snapshotUpdateBroadcastReactor,
      }),
    );
  }

  private registerBillingReportingPipeline() {
    const ReportUsageForMonthCommand = createReportUsageForMonthCommandClass({
      prisma: this.deps.prisma,
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
        ReportUsageForMonthCommand,
      }),
    );
  }

  private registerExperimentRunPipeline() {
    const repository = this.deps.clickhouse
      ? new ExperimentRunStateRepositoryClickHouse(this.deps.clickhouse)
      : new ExperimentRunStateRepositoryMemory();

    return this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore:
          createExperimentRunStateFoldStore(repository),
        experimentRunItemAppendStore: createExperimentRunItemAppendStore(
          this.deps.clickhouse,
        ),
        esSync: createExperimentRunEsSyncReactor({
          project: this.deps.projects,
          repository: createElasticsearchBatchEvaluationRepository(),
        }),
      }),
    );
  }
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;
