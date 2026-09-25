import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createTenantId } from "@langwatch/eventing";
import type { EventingParticipation, PriorEventsRead, ResourceOwnership } from "@langwatch/kernel";
import {
  loadRunAttachments,
  SCENARIO_WORKER,
  SimulationRunNotFoundError,
  type RunScenarioEvaluationsDeps,
  type SimulationProcessingEvent,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { Protections, TraceApi } from "@langwatch/trace-contract";

import type { CancellationPublisher } from "../app/scenario.app.ts";
import { ComputeRunMetricsCommand } from "../eventing/compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../eventing/finish-run.commands.ts";
import { QueueRunCommand } from "../eventing/queue-run.commands.ts";
import { RecordEvaluationsCommand } from "../eventing/record-evaluations.commands.ts";
import {
  SCENARIO_EVALUATIONS_PROCESS_NAME,
  scenarioEvaluationsPM,
} from "../eventing/scenario-evaluations.process.ts";
import {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDefinition,
} from "../eventing/simulation-processing.pipeline.ts";
import {
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  simulationRunExecutionPM,
} from "../eventing/simulation-run-execution.process.ts";
import type { SnapshotUpdateBroadcastSubscriberDeps } from "../eventing/snapshot-update-broadcast.subscriber.ts";
import type { SuiteRunSyncSubscriberDeps } from "../eventing/suite-run-sync.subscriber.ts";
import type { SimulationRunProcessingRepository } from "../repositories/simulation-run-processing.repository.ts";
import { isSimulationProcessingEvent } from "../rules/simulation-run-event.rules.ts";
import { ScenarioExecutionPoolService } from "./scenario-execution-pool.service.ts";
import type { ScenarioExecutorService } from "./scenario-executor.service.ts";
import { ScenarioRunDispatchService } from "./scenario-run-dispatch.service.ts";
import type { SimulationCommandDispatcherService } from "./simulation-command-dispatcher.service.ts";

export type SimulationTraceReads = Pick<
  TraceApi,
  "findSummary" | "deriveScenarioRoleMetrics" | "readOrderedSpansForTrace"
>;

/** What grading a finished run reads through its peers. */
export interface SimulationGradingPeers {
  scenarios: RunScenarioEvaluationsDeps["scenarios"];
  suites: RunScenarioEvaluationsDeps["suites"];
  evaluations: Pick<EvaluationApi, "runEvaluator" | "reportEvaluation">;
}

/** Grading reads the run's spans whole, as main's worker did: no viewer redaction. */
const GRADING_PROTECTIONS: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** What simulation_processing's `build` is handed by the process. */
export interface SimulationPipelineSetup {
  readonly participation: EventingParticipation;
  readonly priorEvents?: PriorEventsRead;
  /** Where the consuming executor registers its drain. */
  readonly resources?: Pick<ResourceOwnership, "own">;
}

/**
 * simulation_processing, ported from main's worker composition: run fold and
 * metrics over scenario's repositories, ECST commands reading the run's own
 * earlier events, and the execution pool built only on consume (WP-5 ruling 3).
 */
export class SimulationProcessingService {
  private constructor(
    private readonly input: {
      runs: SimulationRunProcessingRepository;
      cancellations: CancellationPublisher;
      traces: SimulationTraceReads;
      retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">;
      commands: SimulationCommandDispatcherService;
      simulations: SimulationService;
      suiteRuns: SuiteRunSyncSubscriberDeps;
      snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
      executor: ScenarioExecutorService;
      grading: SimulationGradingPeers;
    },
  ) {}

  static create(input: {
    runs: SimulationRunProcessingRepository;
    cancellations: CancellationPublisher;
    traces: SimulationTraceReads;
    retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">;
    commands: SimulationCommandDispatcherService;
    simulations: SimulationService;
    suiteRuns: SuiteRunSyncSubscriberDeps;
    snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
    executor: ScenarioExecutorService;
    grading: SimulationGradingPeers;
  }): SimulationProcessingService {
    return new SimulationProcessingService(input);
  }

  buildPipeline(setup: SimulationPipelineSetup): SimulationProcessingPipelineDefinition {
    const { runs, cancellations, traces, retention, commands, simulations } = this.input;
    const loadPriorEvents = this.#priorEventsLoader(setup.priorEvents);
    const pool =
      setup.participation === "consume"
        ? ScenarioExecutionPoolService.create({ concurrency: SCENARIO_WORKER.CONCURRENCY })
        : void 0;
    if (pool) this.input.executor.connect({ pool, resources: setup.resources });

    const simulationRunStore = runs.runStateStore({
      defaultRetentionDays: () => retention.getPlatformDefaultRetentionDays(),
    });
    const evaluations = this.#gradingDeps(simulationRunStore);
    const loadAttachments = (params: {
      projectId: string;
      scenarioId: string;
      planId: string | null;
    }) => loadRunAttachments({ deps: evaluations, ...params });

    return SimulationProcessingPipelineAdapter.create({
      simulationRunStore,
      simulationRunMetricsStore: runs.runMetricsStore(),
      queueRunCommand: new QueueRunCommand({ loadRunAttachments: loadAttachments }),
      finishRunCommand: new FinishRunCommand({
        loadPriorEvents,
        loadRunAttachments: loadAttachments,
      }),
      recordEvaluationsCommand: new RecordEvaluationsCommand({ loadPriorEvents }),
      computeRunMetricsCommand: new ComputeRunMetricsCommand({
        traceSummaryStore: {
          get: async (traceId, context) => {
            const summary = await traces.findSummary({
              projectId: String(context.tenantId),
              traceId,
            });
            return summary ? { kind: "folded", state: summary } : { kind: "empty" };
          },
        },
        scheduleRetry: (payload) => commands.scheduleComputeRunMetricsRetry(payload),
        deriveScenarioRoleMetrics: (params) => traces.deriveScenarioRoleMetrics(params),
      }),
      scenarioRunExecution: {
        name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
        process: simulationRunExecutionPM(
          ScenarioRunDispatchService.create({ pool, cancellations }),
          simulations,
          (params) => this.#evaluatorNames(params),
        ),
      },
      scenarioEvaluations: {
        name: SCENARIO_EVALUATIONS_PROCESS_NAME,
        process: scenarioEvaluationsPM({ evaluations, loadPriorEvents }),
      },
      simulations,
      snapshotUpdateBroadcast: this.input.snapshotUpdates,
      suiteRunSync: this.input.suiteRuns,
      traceMetricsSync: { computeRunMetrics: (data) => commands.computeRunMetrics(data) },
    });
  }

  /** Main's grading deps: the run's fold, its spans unredacted, and the evaluation runtime. */
  #gradingDeps(
    simulationRunStore: ReturnType<SimulationRunProcessingRepository["runStateStore"]>,
  ): RunScenarioEvaluationsDeps {
    const { traces, simulations, grading } = this.input;
    return {
      scenarios: grading.scenarios,
      suites: grading.suites,
      runs: {
        getRunState: async ({ tenantId, scenarioRunId }) => {
          const read = await simulationRunStore.get(scenarioRunId, {
            tenantId: createTenantId(tenantId),
            aggregateId: scenarioRunId,
          });
          if (read.kind === "empty") throw new SimulationRunNotFoundError(scenarioRunId);
          return {
            messages: read.state.Messages.map((row) => ({ role: row.Role, content: row.Content })),
            traceIds: read.state.TraceIds,
          };
        },
      },
      spans: {
        getSpansByTraceId: ({ tenantId, traceId }) =>
          traces.readOrderedSpansForTrace({
            projectId: tenantId,
            traceId,
            protections: GRADING_PROTECTIONS,
          }),
      },
      runEvaluation: ({ projectId, evaluatorType, data, settings, workflowId }) =>
        grading.evaluations.runEvaluator({
          projectId,
          evaluatorType,
          data,
          settings: settings ?? {},
          ...(workflowId !== undefined && { workflowId }),
        }),
      reportEvaluation: (report) => grading.evaluations.reportEvaluation(report),
      recordEvaluations: (data) => simulations.recordEvaluations(data),
    };
  }

  /** The saved evaluators' names, for the results a lost grading records. */
  async #evaluatorNames(params: {
    projectId: string;
    attachments: readonly { evaluatorId: string }[];
  }): Promise<Map<string, string>> {
    const evaluators = await this.input.grading.suites.getAttachedEvaluators(params);
    return new Map([...evaluators].map(([id, evaluator]) => [id, evaluator.name]));
  }

  #priorEventsLoader(
    priorEvents: PriorEventsRead | undefined,
  ): (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<readonly SimulationProcessingEvent[]> {
    return ({ tenantId, scenarioRunId }) => {
      if (!priorEvents) {
        return Promise.reject(
          new Error(
            `simulation_processing reads run ${scenarioRunId}'s earlier events, but this process handed it no event log.`,
          ),
        );
      }
      return priorEvents({
        tenantId,
        aggregateId: scenarioRunId,
        accepts: isSimulationProcessingEvent,
      });
    };
  }
}
