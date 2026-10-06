import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import {
  createTenantId,
  type EventingParticipation,
  type PriorEventsRead,
} from "@langwatch/eventing";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  loadRunAttachments,
  SimulationRunNotFoundError,
  type RunScenarioEvaluationsDeps,
  type SimulationProcessingEvent,
  type SimulationService,
  type ScenarioResourceClass,
} from "@langwatch/scenario-contract";
import type { Protections, TraceApi } from "@langwatch/trace-contract";

import type { CancellationPublisher } from "../app/scenario.app.ts";
import type { SimulationRunProcessingRepository } from "../repositories/simulation-run-processing.repository.ts";
import { consumesJobClass } from "../rules/resource-class-admission.rules.ts";
import { isSimulationProcessingEvent } from "../rules/simulation-run-event.rules.ts";
import { ScenarioExecutionPoolService } from "../services/scenario-execution-pool.service.ts";
import type { ScenarioExecutorService } from "../services/scenario-executor.service.ts";
import { ScenarioRunDispatchService } from "../services/scenario-run-dispatch.service.ts";
import type { SimulationCommandDispatcherService } from "../services/simulation-command-dispatcher.service.ts";
import { ComputeRunMetricsCommand } from "./compute-run-metrics.commands.ts";
import { FinishRunCommand } from "./finish-run.commands.ts";
import { QueueRunCommand } from "./queue-run.commands.ts";
import { RecordEvaluationsCommand } from "./record-evaluations.commands.ts";
import {
  SCENARIO_EVALUATIONS_PROCESS_NAME,
  scenarioEvaluationsPM,
} from "./scenario-evaluations.process.ts";
import {
  SimulationProcessingPipelineAdapter,
  type SimulationProcessingPipelineDefinition,
} from "./simulation-processing.pipeline.ts";
import {
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  simulationRunExecutionPM,
} from "./simulation-run-execution.process.ts";
import type { SnapshotUpdateBroadcastSubscriberDeps } from "./snapshot-update-broadcast.subscriber.ts";
import type { SuiteRunSyncSubscriberDeps } from "./suite-run-sync.subscriber.ts";

type SimulationTraceReads = Pick<
  TraceApi,
  "findSummary" | "deriveScenarioRoleMetrics" | "readOrderedSpansForTrace"
>;

/** What grading a finished run reads through its peers. */
interface SimulationGradingPeers {
  scenarios: RunScenarioEvaluationsDeps["scenarios"];
  suites: RunScenarioEvaluationsDeps["suites"];
  evaluations: Pick<EvaluationApi, "runEvaluator" | "reportEvaluation">;
}

/** Where a finished run reads its organization's admin, which the finished event carries. */
interface SimulationMilestonePeers {
  projects: Pick<ProjectApi, "resolveOrgAdmin">;
}

/** Grading reads the run's spans whole, as main's worker did: no viewer redaction. */
const GRADING_PROTECTIONS: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** What this worker's pool holds: the slots it has and the runtime classes it consumes. */
interface ExecutionPoolBudget {
  readonly slotBudget: number;
  readonly consumed: readonly ScenarioResourceClass[];
}

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
export class SimulationProcessingRuntimeAdapter {
  private constructor(
    private readonly input: {
      runs: SimulationRunProcessingRepository;
      cancellations: CancellationPublisher;
      traces: SimulationTraceReads;
      retention: Pick<
        DataRetentionApi,
        "getPlatformDefaultRetentionDays" | "getResolvedForProject"
      >;
      commands: SimulationCommandDispatcherService;
      simulations: SimulationService;
      suiteRuns: SuiteRunSyncSubscriberDeps;
      snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
      executor: ScenarioExecutorService;
      grading: SimulationGradingPeers;
      milestones: SimulationMilestonePeers;
      pool: ExecutionPoolBudget;
    },
  ) {}

  static create(input: {
    runs: SimulationRunProcessingRepository;
    cancellations: CancellationPublisher;
    traces: SimulationTraceReads;
    retention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays" | "getResolvedForProject">;
    commands: SimulationCommandDispatcherService;
    simulations: SimulationService;
    suiteRuns: SuiteRunSyncSubscriberDeps;
    snapshotUpdates: SnapshotUpdateBroadcastSubscriberDeps;
    executor: ScenarioExecutorService;
    grading: SimulationGradingPeers;
    milestones: SimulationMilestonePeers;
    pool: ExecutionPoolBudget;
  }): SimulationProcessingRuntimeAdapter {
    return new SimulationProcessingRuntimeAdapter(input);
  }

  buildPipeline(setup: SimulationPipelineSetup): SimulationProcessingPipelineDefinition {
    const { runs, cancellations, traces, retention, commands, simulations } = this.input;
    const loadPriorEvents = this.#priorEventsLoader(setup.priorEvents);
    const pool =
      setup.participation === "consume"
        ? ScenarioExecutionPoolService.create({
            concurrency: this.input.pool.slotBudget,
            acceptJob: (job) => consumesJobClass({ consumed: this.input.pool.consumed, job }),
          })
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
        loadOrganizationAdmin: (projectId) =>
          this.input.milestones.projects.resolveOrgAdmin(projectId),
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
      traceSpanMetricsSync: {
        findSummary: (input) => traces.findSummary(input),
        computeRunMetrics: (data) => commands.computeRunMetrics(data),
      },
      retention: {
        resolve: (tenantId) => retention.getResolvedForProject({ projectId: tenantId }),
      },
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
