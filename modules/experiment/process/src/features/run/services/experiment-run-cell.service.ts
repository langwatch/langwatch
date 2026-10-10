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
} from "@langwatch/experiment-contract";
import type { SerializedHandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import {
  comparisonSkipMessage,
  type ComparisonSkipReason,
} from "../../../eventing/experiment-comparison-skip.process.ts";
import { buildStripScoreEvaluatorIds } from "../../../eventing/experiment-evaluator-score-filter.process.ts";
import type { CellFinishedEventData } from "../../../eventing/experiment-run-events.process.ts";
import type { ExperimentRunEventStreamRepository } from "../../../repositories/experiment-run-event-stream.repository.ts";
import type {
  ExperimentRunFoldRepository,
  ExperimentRunProgressState,
} from "../../../repositories/experiment-run-fold.repository.ts";
import type { ExperimentRunCollaborators } from "../../../rules/experiment-run-input.rules.ts";
import { makeExperimentRunKey } from "../../../rules/experiment-run-key.rules.ts";
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
} from "../../../rules/experiment-run-plan.rules.ts";
import { loadedDataForTarget } from "../../../rules/experiment-target-data.rules.ts";
import { ExperimentCellExecutionService } from "../../../services/experiment-cell-execution.service.ts";
import { ExperimentCellLoadService } from "../../../services/experiment-cell-load.service.ts";
import { ExperimentCellRecordService } from "../../../services/experiment-cell-record.service.ts";
import { ExperimentComparisonPlanService } from "../../../services/experiment-comparison-plan.service.ts";
import { ExperimentConnectedCellService } from "../../../services/experiment-connected-cell.service.ts";
import type {
  ExecutionDataServices,
  LoadedWorkflow,
} from "../../../services/experiment-execution-data.service.ts";
import { ExperimentTargetLoadingService } from "../../../services/experiment-target-loading.service.ts";
import { ExperimentWorkflowCellService } from "../../workflow/services/experiment-workflow-cell.service.ts";

const logger = createLogger("langwatch:experiment:run-cell");

const targetLoading = ExperimentTargetLoadingService.create();

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
export type LoadedCellRun = {
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, Agent>;
  loadedWorkflows: Map<string, LoadedWorkflow>;
  loadedEvaluators: Map<string, Evaluator>;
  sandboxApiKey?: string;
};

/** What every step of one cell reads. */
export type CellScope = {
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
  private readonly loading: ExperimentCellLoadService;
  private readonly recording: ExperimentCellRecordService;

  private constructor(deps: ExperimentRunCellDeps) {
    this.folds = deps.folds;
    this.stream = deps.stream;
    this.collaborators = deps.collaborators;
    this.services = deps.services;
    this.workflows = deps.workflows;
    this.loading = ExperimentCellLoadService.create(deps);
    this.recording = ExperimentCellRecordService.create(deps);
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
      loaded = await this.loading.load({
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
      loaded = await this.loading.load({
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
    const results = await this.recording.record({
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
        ...(await this.recording.record({
          scope,
          event,
          loadedEvaluators: loaded.loadedEvaluators,
        })),
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

function runKeyOf(request: ExperimentCellRequest): string {
  return makeExperimentRunKey(request.experimentId, request.runId);
}
