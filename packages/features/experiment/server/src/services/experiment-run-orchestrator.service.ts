/** Manages evaluation execution across multiple cells: builds and dispatches workflows, maps events to SSE, and coordinates parallel, abortable runs. */

import {
  type ESBatchEvaluationTarget,
  type EvaluationsV3State,
  type EvaluationV3Event,
  type EvaluatorConfig,
  type ExecutionCell,
  type ExecutionScope,
  type RecordEvaluatorResultCommandData,
  type RecordTargetResultCommandData,
  type TargetConfig,
} from "@langwatch/experiment-contract";
import type { ExecutionState, StudioWorkflow, WorkflowService } from "@langwatch/workflow-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { ExperimentModelCostPort } from "../ports/experiment-model-cost.port";
import type { ExperimentRunAbortPort } from "../ports/experiment-run-abort.port";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process";
import { type LoadedEvaluators } from "./experiment-execution-data.service";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service";
import { ExperimentCellPlanService, type SeededTargetOutput } from "./experiment-cell-plan.service";
import {
  ExperimentComparisonPlanService,
  type VariantEvaluatorScore,
} from "./experiment-comparison-plan.service";
import {
  ExperimentCellExecutionService,
  type LoadedCellData,
} from "./experiment-cell-execution.service";
import { ExperimentWorkflowCellService } from "./experiment-workflow-cell.service";
import { ExperimentConnectedCellService } from "./experiment-connected-cell.service";
import { ExperimentRunStorageService } from "./experiment-run-storage.service";
import {
  comparisonSkipMessage as processComparisonSkipMessage,
  formatList as processFormatList,
  type ComparisonSkipReason,
} from "../processes/experiment-comparison-skip.process";
import type {
  ConnectedCellInput,
  ExperimentRunPorts,
  OrchestratorInput,
} from "../rules/experiment-run-input.rules";
import { ExperimentRunDriverService } from "./experiment-run-driver.service";

const cellPlan = ExperimentCellPlanService.create();

const comparisonPlan = ({
  loadedPrompts,
  loadedEvaluators,
}: {
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: LoadedEvaluators;
}) => ExperimentComparisonPlanService.create({ loadedPrompts, loadedEvaluators });

/** Re-exported so it moved with its owner without duplicating the type. */
export type { ComparisonSkipReason } from "../processes/experiment-comparison-skip.process";

const cellExecution = (ports: ExperimentRunPorts, workflows: WorkflowService) =>
  ExperimentCellExecutionService.create({ ports, workflows });

const workflowCell = (ports: ExperimentRunPorts, workflows: WorkflowService) =>
  ExperimentWorkflowCellService.create({
    ports,
    workflows,
    cells: cellExecution(ports, workflows),
  });

const evaluatorInputSvc = ExperimentEvaluatorInputService.create({});

/** The `error_type` a row carries when an evaluator resolved no input at all. */
export const NO_INPUTS_RESOLVED = "NoInputsResolved";

const resultDispatches = ExperimentResultDispatchService.create();

const carriedBoard = ExperimentCarriedBoardService.create({ dispatches: resultDispatches });

/**
 * The workbench run loop: what a run plans, what each cell executes, and how
 * its results are dispatched.
 */
export class ExperimentRunOrchestratorService {
  private constructor() {}

  static create(): ExperimentRunOrchestratorService {
    return new ExperimentRunOrchestratorService();
  }

  /** The dataset rows a run may touch, given its scope. Delegates to {@link ExperimentCellPlanService}. */
  static resolveScopedRowIndices = (
    input: Parameters<ExperimentCellPlanService["resolveScopedRowIndices"]>[0],
  ): number[] => cellPlan.resolveScopedRowIndices(input);

  /** Generates all cells to execute based on the scope. Delegates to {@link ExperimentCellPlanService}. */
  static generateCells = (
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">,
    datasetRows: Array<Record<string, unknown>>,
    scope: ExecutionScope,
    options: { seedTargetOutputs?: Record<string, SeededTargetOutput> } = {},
  ): ExecutionCell[] =>
    cellPlan.generateCells({
      state,
      datasetRows,
      scope,
      seedTargetOutputs: options.seedTargetOutputs,
    });

  /** How many cells a scope will dispatch, before the run starts. Delegates to {@link ExperimentCellPlanService}. */
  static countScopedCells = ({
    state,
    datasetRows,
    scope,
    seedTargetOutputs,
  }: {
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
    datasetRows: Array<Record<string, unknown>>;
    scope: ExecutionScope;
    seedTargetOutputs?: Record<string, SeededTargetOutput>;
  }): number => cellPlan.countScopedCells({ state, datasetRows, scope, seedTargetOutputs });

  /** "a", "a and b", "a, b and c" — for the skip-reason message. Delegates to the comparison-skip process. */
  static formatList = (names: string[]): string => processFormatList(names);

  /** The row-level error copy for a skipped comparison. Delegates to the comparison-skip process. */
  static comparisonSkipMessage = (
    reason: Pick<ComparisonSkipReason, "kind" | "variantNames">,
  ): { detail: string; errorType: string } => processComparisonSkipMessage(reason);

  /**
   * The Phase 2 back-fill event for one REUSED (not executed) candidate output (#5789 fix 2), or `null` when this
   * entry does not need one: it was already produced this run, its key does not parse to a row/target pair, its row
   * is outside this run's scope, the row no longer exists, or the seeded output itself is absent.
   */
  static tryBuildSeededTargetResultEvent(
    key: string,
    seeded: SeededTargetOutput,
    options: {
      storage: Pick<ExperimentRunStorageService, "hasProduced">;
      rowsThisRunOwns: Set<number>;
      datasetRows: Array<Record<string, unknown>>;
    },
  ): EvaluationV3Event | null {
    const { storage, rowsThisRunOwns, datasetRows } = options;
    if (storage.hasProduced(key)) {
      return null;
    }

    const separator = key.indexOf(":");
    if (separator < 0) {
      return null;
    }

    const rowIndex = Number(key.slice(0, separator));
    const targetId = key.slice(separator + 1);
    if (!Number.isInteger(rowIndex)) {
      return null;
    }

    if (!rowsThisRunOwns.has(rowIndex)) {
      return null;
    }

    if (!datasetRows[rowIndex]) {
      return null;
    }

    if (seeded.output === null || seeded.output === undefined) {
      return null;
    }

    return {
      type: "target_result",
      rowIndex,
      targetId,
      output: seeded.output,
      ...(seeded.cost !== undefined && { cost: seeded.cost }),
      ...(seeded.duration !== undefined && {
        duration: seeded.duration,
      }),
    } as EvaluationV3Event;
  }

  /** Phase 2 generator for comparison evaluators. Delegates to {@link ExperimentComparisonPlanService}. */
  static generateComparisonCells = ({
    state,
    datasetRows,
    completedTargetOutputs,
    completedTargetEvaluatorScores,
    loadedPrompts,
    loadedEvaluators,
    scopedRowIndices,
  }: {
    state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
    datasetRows: Array<Record<string, unknown>>;
    completedTargetOutputs: Map<string, SeededTargetOutput>;
    completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
    loadedPrompts?: Map<string, VersionedPrompt>;
    loadedEvaluators?: LoadedEvaluators;
    scopedRowIndices: number[] | undefined;
  }): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] } =>
    comparisonPlan({ loadedPrompts, loadedEvaluators }).generateComparisonCells({
      state,
      datasetRows,
      completedTargetOutputs,
      completedTargetEvaluatorScores,
      scopedRowIndices,
    });

  /**
   * Prices an LLM node's token usage at the project's canonical model rate. Kept as its own tiny implementation (not
   * a delegation) — it only reaches `cost`, and {@link ExperimentCellExecutionService} is built from the full port
   * bag plus a workflow service this call site does not have.
   */
  static priceMetrics = async (
    cost: ExperimentModelCostPort,
    projectId: string,
    metrics: ExecutionState["metrics"] | undefined,
  ): Promise<number | undefined> => {
    if (!metrics?.model) {
      return undefined;
    }

    const inputTokens = metrics.prompt_tokens ?? 0;
    const outputTokens = metrics.completion_tokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) {
      return undefined;
    }

    return cost.tryPriceTokens({ projectId, model: metrics.model, inputTokens, outputTokens });
  };

  /** Executes a single cell and yields events. Delegates to {@link ExperimentCellExecutionService}. */
  static async *executeCell(
    cell: ExecutionCell,
    projectId: string,
    ports: ExperimentRunPorts,
    datasetColumns: Array<{ id: string; name: string; type: string }>,
    loadedData: LoadedCellData,
    workflows: WorkflowService,
    resultMapperConfig?: ResultMapperConfig,
    isAborted?: () => Promise<boolean>,
  ): AsyncGenerator<EvaluationV3Event> {
    yield* cellExecution(ports, workflows).executeCell({
      cell,
      projectId,
      datasetColumns,
      loadedData,
      resultMapperConfig,
      isAborted,
    });
  }

  /** Executes a single cell whose target is a whole studio workflow. Delegates to {@link ExperimentWorkflowCellService}. */
  static async *executeWorkflowCell({
    cell,
    projectId,
    workflowDsl,
    datasetColumns = [],
    loadedEvaluators,
    resultMapperConfig,
    isAborted,
    ports,
    workflows,
    sandboxApiKey,
  }: {
    cell: ExecutionCell;
    projectId: string;
    workflowDsl: StudioWorkflow;
    datasetColumns?: Array<{ id: string; name: string; type: string }>;
    loadedEvaluators?: LoadedEvaluators;
    resultMapperConfig?: ResultMapperConfig;
    isAborted?: () => Promise<boolean>;
    ports: ExperimentRunPorts;
    workflows: WorkflowService;
    /** The run's agent cache credential, when it minted one. */
    sandboxApiKey?: string;
  }): AsyncGenerator<EvaluationV3Event> {
    yield* workflowCell(ports, workflows).executeWorkflowCell({
      cell,
      projectId,
      workflowDsl,
      datasetColumns,
      loadedEvaluators,
      resultMapperConfig,
      isAborted,
      sandboxApiKey,
    });
  }

  /**
   * turn through the relay dispatcher, since the agent runs in the customer's own process. Each row is
   * its own conversation, no history carried. Delegates to {@link ExperimentConnectedCellService}.
   * Executes a single cell whose target is a connected agent (ADR-128): one
   */
  static async *executeConnectedCell(input: ConnectedCellInput): AsyncGenerator<EvaluationV3Event> {
    const { ports, workflows, dispatch, sleep, now, ...cellInput } = input;
    yield* ExperimentConnectedCellService.create({
      ports,
      workflows,
      cells: cellExecution(ports, workflows),
      dispatch,
      sleep,
      now,
    }).executeConnectedCell(cellInput);
  }

  /** Builds the per-evaluator dispatch input. Delegates to {@link ExperimentEvaluatorInputService}. */
  static buildEvaluatorInputs = (
    cell: ExecutionCell,
    evaluatorId: string,
    targetOutput: Record<string, unknown>,
  ): Record<string, unknown> =>
    evaluatorInputSvc.buildEvaluatorInputs({ cell, evaluatorId, targetOutput });

  /** What the row calls the evaluator column that could not run. Delegates to {@link ExperimentEvaluatorInputService}. */
  static evaluatorTargetDisplayName = ({
    target,
    loadedEvaluators,
  }: {
    target: TargetConfig;
    loadedEvaluators?: LoadedEvaluators;
  }): string =>
    ExperimentEvaluatorInputService.create({ loadedEvaluators }).evaluatorTargetDisplayName({
      target,
    });

  /** Whether dispatching this evaluator COLUMN would hand it nothing to read. Delegates to {@link ExperimentEvaluatorInputService}. */
  static evaluatorTargetHasNoResolvedInputs = ({
    cell,
    loadedEvaluators,
  }: {
    cell: ExecutionCell;
    loadedEvaluators?: LoadedEvaluators;
  }): boolean =>
    ExperimentEvaluatorInputService.create({ loadedEvaluators }).evaluatorTargetHasNoResolvedInputs(
      {
        cell,
      },
    );

  /** Whether dispatching would hand the evaluator nothing to read. Delegates to {@link ExperimentEvaluatorInputService}. */
  static hasNoResolvedInputs = ({
    cell,
    evaluator,
    inputs,
  }: {
    cell: ExecutionCell;
    evaluator: EvaluatorConfig;
    inputs: Record<string, unknown>;
  }): boolean => evaluatorInputSvc.hasNoResolvedInputs({ cell, evaluator, inputs });

  /** Build the per-target metadata stored with a run. Delegates to {@link ExperimentResultDispatchService}. */
  static buildTargetMetadata = (
    input: Parameters<ExperimentResultDispatchService["buildTargetMetadata"]>[0],
  ): ESBatchEvaluationTarget[] => resultDispatches.buildTargetMetadata(input);

  /** Build the recordTargetResult dispatch payload. Delegates to {@link ExperimentResultDispatchService}. */
  static buildTargetResultDispatch = (
    input: Parameters<ExperimentResultDispatchService["tryBuildTargetResultDispatch"]>[0],
  ): RecordTargetResultCommandData | null => resultDispatches.tryBuildTargetResultDispatch(input);

  /** Build the recordEvaluatorResult dispatch payload. Delegates to {@link ExperimentResultDispatchService}. */
  static buildEvaluatorResultDispatch = (
    input: Parameters<ExperimentResultDispatchService["buildEvaluatorResultDispatch"]>[0],
  ): RecordEvaluatorResultCommandData => resultDispatches.buildEvaluatorResultDispatch(input);

  /**
   * Build the stored rows for board cells a run carries rather than
   * produces. Delegates to {@link ExperimentCarriedBoardService}.
   */
  static buildCarriedOverDispatches = (
    input: Parameters<ExperimentCarriedBoardService["buildCarriedOverDispatches"]>[0],
  ): ReturnType<ExperimentCarriedBoardService["buildCarriedOverDispatches"]> =>
    carriedBoard.buildCarriedOverDispatches(input);

  /** Main orchestrator: executes all cells and yields SSE events, with parallel execution under a semaphore. */
  static runOrchestrator(input: OrchestratorInput): AsyncGenerator<EvaluationV3Event> {
    return ExperimentRunDriverService.runOrchestrator(input);
  }

  /**
   * Requests abort of a running execution.
   */
  static requestAbort = async ({
    abort,
    runId,
  }: {
    abort: ExperimentRunAbortPort;
    runId: string;
  }): Promise<void> => {
    await abort.requestAbort(runId);
  };
}
