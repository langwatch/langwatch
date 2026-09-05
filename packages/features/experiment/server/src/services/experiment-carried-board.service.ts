/**
 * The board cells a run carries rather than produces, so opening a run shows the whole board, not one column. Not
 * routed through storage's own event path or the SSE stream — that would re-report old verdicts and overwrite
 * cells this run never produced. A write failure is logged and dropped rather than stopping the run.
 */

import type {
  CarriedOverCell,
  EvaluationsV3State,
  ExperimentService,
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
} from "@langwatch/experiment-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";
import type { LoadedEvaluators } from "./experiment-execution-data.service";
import type { ExperimentResultDispatchService } from "./experiment-result-dispatch.service";

const logger = createLogger("langwatch:experiment:run-orchestrator");

export class ExperimentCarriedBoardService {
  static create({
    commands,
    dispatches,
  }: {
    /** Only read by `recordCarriedOverBoard` — `buildCarriedOverDispatches` is pure and never touches it. */
    commands?: ExperimentService;
    dispatches: ExperimentResultDispatchService;
  }): ExperimentCarriedBoardService {
    return new ExperimentCarriedBoardService(commands, dispatches);
  }

  private constructor(
    private readonly commands: ExperimentService | undefined,
    private readonly dispatches: ExperimentResultDispatchService,
  ) {}

  /** The optional halves of a carried cell — an absent cost is not a zero cost, and an absent trace is not a missing one. */
  private carriedCellFields(cell: CarriedOverCell) {
    return {
      ...(cell.cost !== undefined ? { cost: cell.cost } : {}),
      ...(cell.duration !== undefined ? { duration: cell.duration } : {}),
      ...(cell.traceId !== undefined ? { traceId: cell.traceId } : {}),
      ...(cell.error !== undefined ? { error: cell.error } : {}),
      ...(cell.domainError !== undefined ? { domainError: cell.domainError } : {}),
    };
  }

  /** The statuses the store knows. A verdict with any other is dropped. */
  private isStorableVerdict(
    result: SingleEvaluationResult | undefined,
  ): result is SingleEvaluationResult {
    return (
      result?.status === "processed" || result?.status === "error" || result?.status === "skipped"
    );
  }

  /**
   * The target row a carried cell contributes, or null when it holds none.
   * A cell with neither output nor failure gets no row — writing one
   * would say the column produced nothing.
   */
  private carriedTargetResult({
    tenantId,
    runId,
    experimentId,
    cell,
    datasetEntry,
    occurredAt,
  }: {
    tenantId: string;
    runId: string;
    experimentId: string;
    cell: CarriedOverCell;
    datasetEntry: Record<string, unknown>;
    occurredAt: number;
  }): RecordTargetResultCommandData | null {
    const hasOutput = cell.output !== undefined && cell.output !== null;
    if (!hasOutput && !cell.error) {
      return null;
    }

    const dispatch = this.dispatches.tryBuildTargetResultDispatch({
      tenantId,
      runId,
      experimentId,
      event: {
        type: "target_result",
        rowIndex: cell.rowIndex,
        targetId: cell.targetId,
        output: cell.output,
        ...this.carriedCellFields(cell),
      },
      datasetEntry,
      occurredAt,
    });

    return dispatch ? { ...dispatch, carriedOver: true } : null;
  }

  /** The verdict rows a carried cell contributes, in board order. */
  private carriedEvaluatorResults({
    tenantId,
    runId,
    experimentId,
    cell,
    evaluatorNameFor,
    occurredAt,
  }: {
    tenantId: string;
    runId: string;
    experimentId: string;
    cell: CarriedOverCell;
    evaluatorNameFor: (evaluatorId: string) => string | null;
    occurredAt: number;
  }): RecordEvaluatorResultCommandData[] {
    return cell.evaluatorResults.flatMap((verdict) => {
      const result = verdict.result as SingleEvaluationResult | undefined;
      if (!this.isStorableVerdict(result)) {
        return [];
      }

      return [
        {
          ...this.dispatches.buildEvaluatorResultDispatch({
            tenantId,
            runId,
            experimentId,
            event: {
              rowIndex: cell.rowIndex,
              targetId: cell.targetId,
              evaluatorId: verdict.evaluatorId,
            },
            result,
            evaluatorName: evaluatorNameFor(verdict.evaluatorId),
            occurredAt,
          }),
          carriedOver: true,
        },
      ];
    });
  }

  buildCarriedOverDispatches({
    tenantId,
    runId,
    experimentId,
    cells,
    datasetRows,
    evaluatorNameFor,
    occurredAt,
  }: {
    tenantId: string;
    runId: string;
    experimentId: string;
    cells: CarriedOverCell[];
    datasetRows: Array<Record<string, unknown>>;
    evaluatorNameFor: (evaluatorId: string) => string | null;
    occurredAt: number;
  }): {
    targetResults: RecordTargetResultCommandData[];
    evaluatorResults: RecordEvaluatorResultCommandData[];
  } {
    const targetResults: RecordTargetResultCommandData[] = [];
    const evaluatorResults: RecordEvaluatorResultCommandData[] = [];

    for (const cell of cells) {
      const datasetEntry = datasetRows[cell.rowIndex];
      if (!datasetEntry) {
        continue;
      }

      const target = this.carriedTargetResult({
        tenantId,
        runId,
        experimentId,
        cell,
        datasetEntry,
        occurredAt,
      });
      if (target) {
        targetResults.push(target);
      }

      evaluatorResults.push(
        ...this.carriedEvaluatorResults({
          tenantId,
          runId,
          experimentId,
          cell,
          evaluatorNameFor,
          occurredAt,
        }),
      );
    }

    return { targetResults, evaluatorResults };
  }

  async recordCarriedOverBoard({
    projectId,
    runId,
    experimentId,
    cells,
    datasetRows,
    state,
    loadedEvaluators,
  }: {
    projectId: string;
    runId: string;
    experimentId: string;
    cells: CarriedOverCell[];
    datasetRows: Array<Record<string, unknown>>;
    state: EvaluationsV3State;
    loadedEvaluators?: LoadedEvaluators;
  }): Promise<void> {
    if (cells.length === 0) {
      return;
    }

    if (!this.commands) {
      throw new Error("ExperimentCarriedBoardService: recordCarriedOverBoard needs commands");
    }

    const commands = this.commands;

    const { targetResults, evaluatorResults } = this.buildCarriedOverDispatches({
      tenantId: projectId,
      runId,
      experimentId,
      cells,
      datasetRows,
      evaluatorNameFor: (evaluatorId) => {
        const config = state.evaluators.find((evaluator) => evaluator.id === evaluatorId);
        const dbEvaluator = config?.dbEvaluatorId
          ? loadedEvaluators?.get(config.dbEvaluatorId)
          : null;

        return dbEvaluator?.name ?? null;
      },
      occurredAt: Date.now(),
    });

    for (const dispatch of targetResults) {
      await commands.recordTargetResult(dispatch).catch((err: unknown) => {
        logger.warn(
          { err, runId, targetId: dispatch.targetId, index: dispatch.index },
          "Failed to record a carried-over target result",
        );
      });
    }

    for (const dispatch of evaluatorResults) {
      await commands.recordEvaluatorResult(dispatch).catch((err: unknown) => {
        logger.warn(
          {
            err,
            runId,
            targetId: dispatch.targetId,
            evaluatorId: dispatch.evaluatorId,
            index: dispatch.index,
          },
          "Failed to record a carried-over evaluator result",
        );
      });
    }

    logger.info(
      {
        runId,
        experimentId,
        carriedTargetResults: targetResults.length,
        carriedEvaluatorResults: evaluatorResults.length,
      },
      "Carried the board into the run",
    );
  }
}
