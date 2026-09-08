/** Manages evaluation execution across cells: builds/dispatches workflows, maps events to SSE. */

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
import type { ExperimentModelCostPort } from "../ports/experiment-model-cost.port.ts";
import type { ExperimentRunAbortPort } from "../ports/experiment-run-abort.port.ts";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process.ts";
import { type LoadedEvaluators } from "./experiment-execution-data.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";
import { ExperimentCarriedBoardService } from "./experiment-carried-board.service.ts";
import { ExperimentEvaluatorInputService } from "./experiment-evaluator-input.service.ts";
import {
  ExperimentCellPlanService,
  type SeededTargetOutput,
} from "./experiment-cell-plan.service.ts";
import {
  ExperimentComparisonPlanService,
  type VariantEvaluatorScore,
} from "./experiment-comparison-plan.service.ts";
import {
  ExperimentCellExecutionService,
  type LoadedCellData,
} from "./experiment-cell-execution.service.ts";
import { ExperimentWorkflowCellService } from "./experiment-workflow-cell.service.ts";
import { ExperimentConnectedCellService } from "./experiment-connected-cell.service.ts";
import { ExperimentRunStorageService } from "./experiment-run-storage.service.ts";
import {
  comparisonSkipMessage as processComparisonSkipMessage,
  formatList as processFormatList,
  type ComparisonSkipReason,
} from "../processes/experiment-comparison-skip.process.ts";
import type {
  ConnectedCellInput,
  ExperimentRunPorts,
  OrchestratorInput,
} from "../rules/experiment-run-input.rules.ts";
import { ExperimentRunDriverService } from "./experiment-run-driver.service.ts";

const cellPlan = ExperimentCellPlanService.create();

const comparisonPlan = ({
  loadedPrompts,
  loadedEvaluators,
}: {
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: LoadedEvaluators;
}) => ExperimentComparisonPlanService.create({ loadedPrompts, loadedEvaluators });

/** Re-exported so it moved with its owner without duplicating the type. */
export type { ComparisonSkipReason } from "../processes/experiment-comparison-skip.process.ts";

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

  /** The dataset rows a run may touch, given its scope. See {@link ExperimentCellPlanService}. */
  static resolveScopedRowIndices = (
    input: Parameters<ExperimentCellPlanService["resolveScopedRowIndices"]>[0],
  ): number[] => cellPlan.resolveScopedRowIndices(input);

  /** Generates all cells to execute for the scope. See {@link ExperimentCellPlanService}. */
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

  /** How many cells a scope dispatches. See {@link ExperimentCellPlanService}. */
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

  /** "a", "a and b", "a, b and c" for the skip-reason message. See the comparison-skip process. */
  static formatList = (names: string[]): string => processFormatList(names);

  /** The row-level error copy for a skipped comparison. See the comparison-skip process. */
  static comparisonSkipMessage = (
    reason: Pick<ComparisonSkipReason, "kind" | "variantNames">,
  ): { detail: string; errorType: string } => processComparisonSkipMessage(reason);

  /** Back-fill event for one REUSED candidate output, or null when this entry needs none. */
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

  /** Phase 2 generator for comparison evaluators. See {@link ExperimentComparisonPlanService}. */
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

  /** Its own tiny implementation, not a delegation: it only reaches `cost`, not a full port bag. */
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

  /** Executes a single cell and yields events. See {@link ExperimentCellExecutionService}. */
  static async *executeCell({
    cell,
    projectId,
    ports,
    datasetColumns,
    loadedData,
    workflows,
    resultMapperConfig,
    isAborted,
  }: {
    cell: ExecutionCell;
    projectId: string;
    ports: ExperimentRunPorts;
    datasetColumns: Array<{ id: string; name: string; type: string }>;
    loadedData: LoadedCellData;
    workflows: WorkflowService;
    resultMapperConfig?: ResultMapperConfig;
    isAborted?: () => Promise<boolean>;
  }): AsyncGenerator<EvaluationV3Event> {
    yield* cellExecution(ports, workflows).executeCell({
      cell,
      projectId,
      datasetColumns,
      loadedData,
      resultMapperConfig,
      isAborted,
    });
  }

  /** Executes a cell targeting a studio workflow. See {@link ExperimentWorkflowCellService}. */
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
   * Executes a cell whose target is a connected agent (ADR-128): one turn through the relay
   * dispatcher. Each row is its own conversation. See {@link ExperimentConnectedCellService}.
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

  /** Builds the per-evaluator dispatch input. See {@link ExperimentEvaluatorInputService}. */
  static buildEvaluatorInputs = (
    cell: ExecutionCell,
    evaluatorId: string,
    targetOutput: Record<string, unknown>,
  ): Record<string, unknown> =>
    evaluatorInputSvc.buildEvaluatorInputs({ cell, evaluatorId, targetOutput });

  /** Row label for a column that couldn't run. See {@link ExperimentEvaluatorInputService}. */
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

  /** Whether this evaluator COLUMN gets nothing. See {@link ExperimentEvaluatorInputService}. */
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

  /** Whether the evaluator gets nothing. See {@link ExperimentEvaluatorInputService}. */
  static hasNoResolvedInputs = ({
    cell,
    evaluator,
    inputs,
  }: {
    cell: ExecutionCell;
    evaluator: EvaluatorConfig;
    inputs: Record<string, unknown>;
  }): boolean => evaluatorInputSvc.hasNoResolvedInputs({ cell, evaluator, inputs });

  /** Per-target metadata stored with a run. See {@link ExperimentResultDispatchService}. */
  static buildTargetMetadata = (
    input: Parameters<ExperimentResultDispatchService["buildTargetMetadata"]>[0],
  ): ESBatchEvaluationTarget[] => resultDispatches.buildTargetMetadata(input);

  /** Build the recordTargetResult dispatch payload. See {@link ExperimentResultDispatchService}. */
  static buildTargetResultDispatch = (
    input: Parameters<ExperimentResultDispatchService["tryBuildTargetResultDispatch"]>[0],
  ): RecordTargetResultCommandData | null => resultDispatches.tryBuildTargetResultDispatch(input);

  /** The recordEvaluatorResult dispatch payload. See {@link ExperimentResultDispatchService}. */
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

  /** Main orchestrator: executes all cells and yields SSE events under a parallel semaphore. */
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
