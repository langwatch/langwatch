import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { EvaluationEsSyncReactorDeps } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createTraceProcessingPipeline } from "./pipelines/trace-processing/pipeline";
import { createEvaluationProcessingPipeline } from "./pipelines/evaluation-processing/pipeline";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import {
  SimulationRunStateRepositoryClickHouse,
  SimulationRunStateRepositoryMemory,
} from "./pipelines/simulation-processing/repositories";
import { createSimulationRunStateFoldStore } from "./pipelines/simulation-processing/projections/simulationRunState.store";
import { createExperimentRunEsSyncReactor } from "./pipelines/experiment-run-processing/reactors/experimentRunEsSync.reactor";
import { createSnapshotUpdateBroadcastReactor } from "./pipelines/simulation-processing/reactors/snapshotUpdateBroadcast";
import { createElasticsearchBatchEvaluationRepository } from "../evaluations-v3/repositories/elasticsearchBatchEvaluation.repository";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import { createExecuteEvaluationCommandClass } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import { createEvaluationEsSyncReactor } from "./pipelines/evaluation-processing/reactors/evaluationEsSync.reactor";
import { createEvaluationTriggerReactor } from "./pipelines/trace-processing/reactors/evaluationTrigger.reactor";
import { createSatisfactionScoreReactor } from "./pipelines/trace-processing/reactors/satisfactionScore.reactor";
import { createTraceUpdateBroadcastReactor } from "./pipelines/trace-processing/reactors/traceUpdateBroadcast.reactor";
import {
  ExperimentRunStateRepositoryClickHouse,
  ExperimentRunStateRepositoryMemory,
} from "./pipelines/experiment-run-processing/repositories";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import { createExperimentRunItemAppendStore } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import { createBillingMeterDispatchReactor } from "./projections/global/billingMeterDispatch.reactor";
import { createBillingReportingPipeline } from "./pipelines/billing-reporting/pipeline";
import { createReportUsageForMonthCommandClass } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import type { ReportUsageForMonthCommandData } from "./pipelines/billing-reporting/schemas/commands";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import { createLogger } from "~/utils/logger/server";

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
  isSaas?: boolean;
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
    // === Mutable refs (wired after pipeline registration) ===
    const reportUsageRef: {
      dispatch: ((data: ReportUsageForMonthCommandData) => Promise<void>) | null;
    } = { dispatch: null };

    // === Register billing reactor BEFORE pipelines ===
    // Must be before first register() call (which triggers ProjectionRegistry.initialize()).
    // Fold "projectDailyBillableEvents" is registered in EventSourcing constructor.
    if (this.deps.isSaas) {
      this.deps.eventSourcing.registerGlobalReactor(
        "projectDailyBillableEvents",
        createBillingMeterDispatchReactor({
          dispatchReportUsageForMonth: (data) => {
            if (!reportUsageRef.dispatch) {
              throw new Error(
                "reportUsageForMonth command not yet wired",
              );
            }
            return reportUsageRef.dispatch(data);
          },
        }),
      );
    }

    // === Register pipelines (triggers ProjectionRegistry.initialize on first call) ===
    const evalPipeline = this.registerEvaluationPipeline();
    const tracePipeline = this.registerTracePipeline(evalPipeline);
    const experimentRunPipeline = this.registerExperimentRunPipeline();
    const simulationPipeline = this.registerSimulationPipeline();

    // selfDispatch ref: command handler dispatches itself for convergence loop
    const selfDispatchRef: {
      dispatch: ((data: ReportUsageForMonthCommandData) => Promise<void>) | null;
    } = { dispatch: null };

    const billingPipeline = this.deps.isSaas
      ? this.registerBillingReportingPipeline({
          selfDispatch: (data) => {
            if (!selfDispatchRef.dispatch) {
              throw new Error("selfDispatch not yet wired");
            }
            return selfDispatchRef.dispatch(data);
          },
        })
      : null;

    // === Wire refs ===
    if (billingPipeline) {
      const reportUsageCommand =
        mapCommands(billingPipeline.commands).reportUsageForMonth;
      reportUsageRef.dispatch = reportUsageCommand;
      selfDispatchRef.dispatch = reportUsageCommand;
    }

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      ...(billingPipeline
        ? { billing: mapCommands(billingPipeline.commands) }
        : {}),
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
        evalRunStore: new EvaluationRunStore(this.deps.evaluations.runs.repository),
        ExecuteEvaluationCommand,
        esSyncReactor,
      }),
    );
  }

  private registerTracePipeline(evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>) {
    const evaluationTriggerReactor = createEvaluationTriggerReactor({
      monitors: this.deps.monitors,
      evaluation: mapCommands(evalPipeline.commands).executeEvaluation,
    });

    const traceUpdateBroadcastReactor = createTraceUpdateBroadcastReactor({
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

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        traceSummaryStore: new TraceSummaryStore(this.deps.traces.summary.repository),
        evaluationTriggerReactor,
        traceUpdateBroadcastReactor,
        satisfactionScoreReactor,
      }),
    );

    // Complete the wiring now that the pipeline is registered
    satisfactionCommandRef.dispatch =
      mapCommands(tracePipeline.commands).assignSatisfactionScore;

    return tracePipeline;
  }

  private registerSimulationPipeline() {
    const repository = this.deps.clickhouse
      ? new SimulationRunStateRepositoryClickHouse(this.deps.clickhouse)
      : new SimulationRunStateRepositoryMemory();
    const simulationRunStore = createSimulationRunStateFoldStore(repository);
    const snapshotUpdateBroadcastReactor = createSnapshotUpdateBroadcastReactor({
      broadcast: this.deps.broadcast,
      hasRedis: !!this.deps.eventSourcing.redisConnection,
    });

    return this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        snapshotUpdateBroadcastReactor,
      }),
    );
  }

  private registerBillingReportingPipeline(selfDispatchDeps: {
    selfDispatch: (data: ReportUsageForMonthCommandData) => Promise<void>;
  }) {
    const ReportUsageForMonthCommand =
      createReportUsageForMonthCommandClass({
        prisma: this.deps.prisma,
        getUsageReportingService: () => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getUsageReportingService } = require("../../../ee/billing/index");
          return getUsageReportingService();
        },
        queryBillableEventsTotal,
        selfDispatch: selfDispatchDeps.selfDispatch,
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
        experimentRunStateFoldStore: createExperimentRunStateFoldStore(repository),
        experimentRunItemAppendStore: createExperimentRunItemAppendStore(this.deps.clickhouse),
        esSync: createExperimentRunEsSyncReactor({
          project: this.deps.projects,
          repository: createElasticsearchBatchEvaluationRepository(),
        }),
      }),
    );
  }
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;
