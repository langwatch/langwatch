/**
 * One cell of a run, run by the worker's ExecuteExperimentCell command (ARCHITECTURE §9): its row,
 * target and evaluators from the plan fold, main's executors, and for a comparison its row's
 * variant outputs from the progress fold (D2, D5). Design: experiment-run-execution.md §3, §6, §8.
 */
import type { Agent } from "@langwatch/agent-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import {
  type EvaluationV3Event,
  type ExecutionCell,
  ExperimentEvaluationInputError,
  type ExperimentRunComparisonCell,
  type ExperimentRunPlan,
  type ExperimentRunTargetCell,
  type RecordEvaluatorResultCommandData,
  type RecordTargetResultCommandData,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import type { SerializedHandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { nowInstant } from "@langwatch/time";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import {
  comparisonSkipMessage,
  type ComparisonSkipReason,
} from "../eventing/experiment-comparison-skip.process.ts";
import { buildStripScoreEvaluatorIds } from "../eventing/experiment-evaluator-score-filter.process.ts";
import type { CellFinishedEventData } from "../eventing/experiment-run-events.process.ts";
import type { ExperimentRunEventStreamRepository } from "../repositories/experiment-run-event-stream.repository.ts";
import type {
  ExperimentRunFoldRepository,
  ExperimentRunProgressState,
} from "../repositories/experiment-run-fold.repository.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { makeExperimentRunKey } from "../rules/experiment-run-key.rules.ts";
import {
  comparisonStateOf,
  completedEvaluatorScoresOf,
  completedTargetOutputsOf,
  getPlanCell,
  isPhaseOneFolded,
  pinnedTargetsOf,
  planDatasetRows,
  runCellKey,
  targetCellOf,
} from "../rules/experiment-run-plan.rules.ts";
import { loadedDataForTarget } from "../rules/experiment-target-data.rules.ts";
import { ExperimentCellExecutionService } from "./experiment-cell-execution.service.ts";
import { ExperimentComparisonPlanService } from "./experiment-comparison-plan.service.ts";
import { ExperimentConnectedCellService } from "./experiment-connected-cell.service.ts";
import type { ExecutionDataServices, LoadedWorkflow } from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import { ExperimentRunSandboxKeyService } from "./experiment-run-sandbox-key.service.ts";
import { ExperimentTargetLoadingService } from "./experiment-target-loading.service.ts";
import { ExperimentWorkflowCellService } from "./experiment-workflow-cell.service.ts";

const logger = createLogger("langwatch:experiment:run-cell");

const EVALUATION_KSUID_RESOURCE = "eval";

const targetLoading = ExperimentTargetLoadingService.create();
const sandboxKey = ExperimentRunSandboxKeyService.create();
const resultDispatches = ExperimentResultDispatchService.create();

/** One cell the manager asked for, by its place in the plan. */
export type ExperimentCellRequest = {
  projectId: string;
  runId: string;
  experimentId: string;
  ordinal: number;
  phase: 1 | 2;
};

/** One result a cell appends before its finish, in the order it produced them. */
export type ExperimentCellResult =
  | { kind: "target"; data: RecordTargetResultCommandData }
  | { kind: "evaluator"; data: RecordEvaluatorResultCommandData };

/** How a cell ended, and the results it appends first. */
export type ExperimentCellExecution = {
  outcome: CellFinishedEventData["outcome"];
  error?: SerializedHandledError;
  results: ExperimentCellResult[];
};

/** What a cell loads of the run's targets before it dispatches. */
type LoadedCellRun = {
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, Agent>;
  loadedWorkflows: Map<string, LoadedWorkflow>;
  loadedEvaluators: Map<string, Evaluator>;
  sandboxApiKey?: string;
};

/** What every step of one cell reads. */
type CellScope = {
  request: ExperimentCellRequest;
  plan: ExperimentRunPlan;
  /** `<rowIndex>:<targetId>` to the trace a verdict is reported against. */
  traceIds: Map<string, string>;
};

const stopped = (results: ExperimentCellResult[] = []): ExperimentCellExecution => ({
  outcome: "stopped",
  results,
});

/** A target, prompt or evaluator removed since the run started fails the cell, not the run. */
const failedToLoad = (error: unknown): ExperimentCellExecution => {
  if (!(error instanceof ExperimentEvaluationInputError)) throw error;
  return { outcome: "failed", error: error.serialize(), results: [] };
};

type ExperimentRunCellDeps = {
  folds: ExperimentRunFoldRepository;
  /** Where a cell's start is announced, ephemeral as main's `cell_started` was. */
  stream: ExperimentRunEventStreamRepository;
  collaborators: ExperimentRunCollaborators;
  services: ExecutionDataServices;
  workflows: WorkflowApi;
};

export class ExperimentRunCellService {
  static create(deps: ExperimentRunCellDeps): ExperimentRunCellService {
    return new ExperimentRunCellService(deps);
  }

  private readonly folds: ExperimentRunFoldRepository;
  private readonly stream: ExperimentRunEventStreamRepository;
  private readonly collaborators: ExperimentRunCollaborators;
  private readonly services: ExecutionDataServices;
  private readonly workflows: WorkflowApi;

  private constructor(deps: ExperimentRunCellDeps) {
    this.folds = deps.folds;
    this.stream = deps.stream;
    this.collaborators = deps.collaborators;
    this.services = deps.services;
    this.workflows = deps.workflows;
  }

  /**
   * Runs one cell. A domain failure ends it `failed`; only a fold that has not caught up, or
   * an infrastructure fault, throws, and the queue retries the command.
   */
  async execute(request: ExperimentCellRequest): Promise<ExperimentCellExecution> {
    if (await this.isAborted(request)) return stopped();

    const plan = await this.getPlan(request);
    const cell = getPlanCell({ plan, ordinal: request.ordinal, phase: request.phase });
    if (cell.phase === 1) {
      return this.executeTargetCell({ request, plan, cell });
    }

    return this.executeComparisonCell({ request, plan, cell });
  }

  private async executeTargetCell({
    request,
    plan,
    cell,
  }: {
    request: ExperimentCellRequest;
    plan: ExperimentRunPlan;
    cell: ExperimentRunTargetCell;
  }): Promise<ExperimentCellExecution> {
    const executionCell = targetCellOf({ plan, cell });
    let loaded: LoadedCellRun;
    try {
      loaded = await this.load({
        projectId: request.projectId,
        userId: plan.actor?.userId ?? null,
        targets: [executionCell.targetConfig],
        evaluators: executionCell.evaluatorConfigs,
      });
    } catch (error) {
      return failedToLoad(error);
    }
    const traceIds = new Map<string, string>();
    if (executionCell.traceId) traceIds.set(runCellKey(executionCell), executionCell.traceId);

    return this.run({ scope: { request, plan, traceIds }, cell: executionCell, loaded });
  }

  /**
   * A comparison runs once every target cell has finished: with its setup skip at once, else
   * judged from its row's variant outputs, or skipped when a variant has none (D5).
   */
  private async executeComparisonCell({
    request,
    plan,
    cell,
  }: {
    request: ExperimentCellRequest;
    plan: ExperimentRunPlan;
    cell: ExperimentRunComparisonCell;
  }): Promise<ExperimentCellExecution> {
    const targets = pinnedTargetsOf(plan);
    if (cell.setupSkip) {
      let loadedEvaluators: Map<string, Evaluator>;
      try {
        loadedEvaluators = await targetLoading.loadEvaluators({
          projectId: request.projectId,
          targets,
          evaluators: plan.evaluators,
          services: this.services,
        });
      } catch (error) {
        return failedToLoad(error);
      }
      return this.skip({
        scope: { request, plan, traceIds: new Map() },
        reason: { ...cell, ...cell.setupSkip },
        loadedEvaluators,
      });
    }

    const progress = await this.getPhaseOneProgress(request);
    let loaded: LoadedCellRun;
    try {
      loaded = await this.load({
        projectId: request.projectId,
        userId: plan.actor?.userId ?? null,
        targets,
        evaluators: plan.evaluators,
      });
    } catch (error) {
      return failedToLoad(error);
    }
    const scope = { request, plan, traceIds: new Map(Object.entries(progress.traceIds)) };
    const planned = ExperimentComparisonPlanService.create({
      loadedPrompts: loaded.loadedPrompts,
      loadedEvaluators: loaded.loadedEvaluators,
    }).generateComparisonCells({
      state: comparisonStateOf(plan),
      datasetRows: planDatasetRows(plan),
      completedTargetOutputs: completedTargetOutputsOf({ plan, progress }),
      completedTargetEvaluatorScores: completedEvaluatorScoresOf({ plan, progress }),
      scopedRowIndices: [cell.rowIndex],
    });
    const isThisCell = (candidate: { targetId: string; evaluatorId: string }): boolean =>
      candidate.targetId === cell.targetId && candidate.evaluatorId === cell.evaluatorId;

    const comparison = planned.cells.find((candidate) =>
      isThisCell({
        targetId: candidate.targetId,
        evaluatorId: candidate.evaluatorConfigs[0]?.id ?? "",
      }),
    );
    if (comparison) return this.run({ scope, cell: comparison, loaded });

    const reason = planned.skipReasons.find(isThisCell);
    if (!reason) return { outcome: "skipped", results: [] };

    return this.skip({ scope, reason, loadedEvaluators: loaded.loadedEvaluators });
  }

  /** A comparison row that cannot be judged: its verdict column reads why, and the cell skips. */
  private async skip({
    scope,
    reason,
    loadedEvaluators,
  }: {
    scope: CellScope;
    reason: ComparisonSkipReason;
    loadedEvaluators: Map<string, Evaluator>;
  }): Promise<ExperimentCellExecution> {
    const { detail, errorType } = comparisonSkipMessage(reason);
    const results = await this.record({
      scope,
      loadedEvaluators,
      event: {
        type: "evaluator_result",
        rowIndex: reason.rowIndex,
        targetId: reason.targetId,
        evaluatorId: reason.evaluatorId,
        result: { status: "error", details: detail, error_type: errorType, traceback: [] },
      },
    });

    return { outcome: "skipped", results };
  }

  /** The cell's events recorded in order, stopping at the first one read after an abort. */
  private async run({
    scope,
    cell,
    loaded,
  }: {
    scope: CellScope;
    cell: ExecutionCell;
    loaded: LoadedCellRun;
  }): Promise<ExperimentCellExecution> {
    if (await this.isAborted(scope.request)) return stopped();

    const results: ExperimentCellResult[] = [];
    let failure: { error?: SerializedHandledError } | undefined;
    for await (const event of this.cellEvents({ scope, cell, loaded })) {
      if (await this.isAborted(scope.request)) return stopped(results);
      if (event.type === "cell_started") {
        await this.announceStart({ request: scope.request, frame: event });
        continue;
      }

      results.push(
        ...(await this.record({ scope, event, loadedEvaluators: loaded.loadedEvaluators })),
      );
      const failed = event.type === "error" || (event.type === "target_result" && !!event.error);
      if (failed && !failure) {
        failure = event.domainError ? { error: event.domainError } : {};
      }
    }

    return failure ? { outcome: "failed", ...failure, results } : { outcome: "succeeded", results };
  }

  /**
   * The executor a cell runs under, as main's run driver chose it: a connected agent through the
   * relay, a workflow target (or a workflow-typed agent) as its committed DSL, else one component.
   */
  private cellEvents({
    scope,
    cell,
    loaded,
  }: {
    scope: CellScope;
    cell: ExecutionCell;
    loaded: LoadedCellRun;
  }): AsyncGenerator<EvaluationV3Event> {
    const { request, plan } = scope;
    const ports = this.collaborators;
    const workflows = this.workflows;
    const loadedData = {
      ...loadedDataForTarget({
        targetConfig: cell.targetConfig,
        loadedPrompts: loaded.loadedPrompts,
        loadedAgents: loaded.loadedAgents,
        loadedWorkflows: loaded.loadedWorkflows,
      }),
      evaluators: loaded.loadedEvaluators,
      sandboxApiKey: loaded.sandboxApiKey,
    };
    const cells = ExperimentCellExecutionService.create({ ports, workflows });
    const resultMapperConfig = {
      stripScoreEvaluatorIds: buildStripScoreEvaluatorIds(plan.evaluators),
    };
    const shared = {
      cell,
      projectId: request.projectId,
      datasetColumns: plan.datasetColumns,
      loadedEvaluators: loaded.loadedEvaluators,
      resultMapperConfig,
      isAborted: () => this.isAborted(request),
      ...(plan.actor?.userId ? { principal: { userId: plan.actor.userId } } : {}),
    };

    if (cell.targetConfig.type === "agent" && loadedData.agent?.type === "connected") {
      return ExperimentConnectedCellService.create({
        ports,
        workflows,
        cells,
      }).executeConnectedCell({ ...shared, agent: loadedData.agent });
    }

    const workflow = loadedData.workflow;
    const runsAsWorkflow =
      cell.targetConfig.type === "workflow" ||
      (cell.targetConfig.type === "agent" && loadedData.agent?.type === "workflow");
    if (runsAsWorkflow && workflow) {
      return ExperimentWorkflowCellService.create({ ports, workflows, cells }).executeWorkflowCell({
        ...shared,
        workflowDsl: workflow.dsl,
        sandboxApiKey: loaded.sandboxApiKey,
      });
    }

    return cells.executeCell({ ...shared, loadedData });
  }

  /** One event as the results it appends, with a verdict reported as an evaluation as main did. */
  private async record({
    scope,
    event: produced,
    loadedEvaluators,
  }: {
    scope: CellScope;
    event: EvaluationV3Event;
    loadedEvaluators: Map<string, Evaluator>;
  }): Promise<ExperimentCellResult[]> {
    const { request, plan, traceIds } = scope;
    const event = keptAsEvaluatorError(produced);
    const envelope = {
      tenantId: request.projectId,
      runId: request.runId,
      experimentId: request.experimentId,
      occurredAt: nowInstant().epochMilliseconds,
    };

    if (event.type === "target_result" || event.type === "error") {
      if (event.type === "target_result" && event.traceId) {
        traceIds.set(runCellKey(event), event.traceId);
      }
      const rows = planDatasetRows(plan);
      const data = resultDispatches.findTargetResultDispatch({
        ...envelope,
        event,
        datasetEntry: event.rowIndex !== undefined ? (rows[event.rowIndex] ?? {}) : {},
      });
      return data ? [{ kind: "target", data }] : [];
    }

    if (event.type !== "evaluator_result") return [];

    const evaluator = plan.evaluators.find((candidate) => candidate.id === event.evaluatorId);
    const dbEvaluator = evaluator?.dbEvaluatorId
      ? loadedEvaluators.get(evaluator.dbEvaluatorId)
      : undefined;
    await this.reportEvaluation({
      request,
      event,
      evaluatorType: evaluator?.evaluatorType ?? "unknown",
      evaluatorName: dbEvaluator?.name,
      traceId: traceIds.get(runCellKey(event)),
    });

    return [
      {
        kind: "evaluator",
        data: resultDispatches.buildEvaluatorResultDispatch({
          ...envelope,
          event,
          result: event.result,
          evaluatorName: dbEvaluator?.name ?? event.evaluatorName ?? null,
        }),
      },
    ];
  }

  /** Reported to the evaluation pipeline, best-effort: a failed report never fails the cell. */
  private async reportEvaluation({
    request,
    event,
    evaluatorType,
    evaluatorName,
    traceId,
  }: {
    request: ExperimentCellRequest;
    event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
    evaluatorType: string;
    evaluatorName: string | undefined;
    traceId: string | undefined;
  }): Promise<void> {
    const result = event.result;
    const processed = result.status === "processed" ? result : undefined;
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
    try {
      await this.collaborators.evaluationReporting.reportEvaluation({
        tenantId: request.projectId,
        evaluationId,
        evaluatorId: event.evaluatorId,
        evaluatorType,
        evaluatorName,
        traceId,
        status: result.status,
        score: processed?.score ?? undefined,
        passed: processed?.passed ?? undefined,
        label: processed?.label ?? undefined,
        details: processed?.details ?? undefined,
        error: result.status === "error" ? result.details : undefined,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error(
        { error, evaluationId, evaluatorId: event.evaluatorId },
        "Failed to dispatch evaluator result to evaluation processing pipeline",
      );
    }
  }

  /** The run's targets a cell needs, as the run pinned them, and the key it lends their code. */
  private async load({
    projectId,
    userId,
    targets,
    evaluators,
  }: {
    projectId: string;
    /** Who started the run; the key lent to its code acts as them, or as the system. */
    userId: string | null;
    targets: TargetConfig[];
    evaluators: { dbEvaluatorId?: string }[];
  }): Promise<LoadedCellRun> {
    const services = this.services;
    const loadedPrompts = await targetLoading.loadPrompts({ projectId, targets, services });

    const loadedAgents = await targetLoading.loadAgents({ projectId, targets, services });

    const loadedWorkflows = await targetLoading.loadWorkflows({
      projectId,
      targets,
      services,
      loadedAgents,
    });

    const loadedEvaluators = await targetLoading.loadEvaluators({
      projectId,
      targets,
      evaluators,
      services,
    });

    const sandboxApiKey = await sandboxKey.findRunSandboxApiKey({
      sandboxCredentials: this.collaborators.sandboxCredentials,
      projectId,
      userId,
      loadedAgents,
      loadedWorkflows,
    });

    return {
      loadedPrompts,
      loadedAgents,
      loadedWorkflows,
      loadedEvaluators,
      ...(sandboxApiKey ? { sandboxApiKey } : {}),
    };
  }

  /** The run's plan; one not folded yet throws, so the queue retries the cell. */
  private async getPlan(request: ExperimentCellRequest): Promise<ExperimentRunPlan> {
    const read = await this.folds.readPlan({ runKey: runKeyOf(request) });
    if (read.kind === "empty" || !read.state.plan) {
      throw new Error(`Run ${request.runId} has no plan folded yet`);
    }
    if (read.state.projectId !== request.projectId) {
      throw new Error(`Run ${request.runId} was started by another project`);
    }

    return read.state.plan;
  }

  /** The run's progress once every target cell's results are folded; until then it throws. */
  private async getPhaseOneProgress(
    request: ExperimentCellRequest,
  ): Promise<ExperimentRunProgressState> {
    const read = await this.folds.readRunProgress({ runId: request.runId });
    if (
      read.kind === "empty" ||
      read.state.experimentId !== request.experimentId ||
      !isPhaseOneFolded(read.state)
    ) {
      throw new Error(`Run ${request.runId} has target cells whose results are not folded yet`);
    }

    return read.state;
  }

  /**
   * Publishes the cell's start straight onto the run's channel, never folded: it carries the last
   * folded seq without advancing it, so a stream passes it through undeduped. Best-effort.
   */
  private async announceStart({
    request,
    frame,
  }: {
    request: ExperimentCellRequest;
    frame: EvaluationV3Event;
  }): Promise<void> {
    try {
      const read = await this.folds.readRunProgress({ runId: request.runId });
      const seq = read.kind === "folded" ? read.state.seq : 0;
      await this.stream.publish({ runId: request.runId, seq, frame });
    } catch (error) {
      logger.warn({ error, runId: request.runId }, "A cell's start could not be announced");
    }
  }

  private isAborted(request: ExperimentCellRequest): Promise<boolean> {
    return this.collaborators.abort.isAborted(request.runId);
  }
}

/** An evaluator's error stays an evaluator's (ARCHITECTURE §9), as evaluatorErrorResult has it. */
function keptAsEvaluatorError(event: EvaluationV3Event): EvaluationV3Event {
  if (event.type !== "error" || !event.evaluatorId) return event;
  if (event.rowIndex === undefined || !event.targetId) return event;

  return {
    type: "evaluator_result",
    rowIndex: event.rowIndex,
    targetId: event.targetId,
    evaluatorId: event.evaluatorId,
    result: {
      status: "error",
      error_type: "EvaluatorError",
      details: event.message,
      traceback: [],
      ...(event.domainError ? { domainError: event.domainError } : {}),
    },
  };
}

function runKeyOf(request: ExperimentCellRequest): string {
  return makeExperimentRunKey(request.experimentId, request.runId);
}
