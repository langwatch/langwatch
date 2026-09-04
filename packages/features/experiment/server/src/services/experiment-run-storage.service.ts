/**
 * Everything a run writes to ClickHouse and the evaluation pipeline as it
 * executes: the run-started/run-completed dispatches, and the per-event
 * `record` that mirrors each target and evaluator result. Also owns the
 * per-(row, target) caches Phase 2 comparison cells read (outputs, scores,
 * which keys this run actually produced) and the traceId lookup evaluator
 * results reference.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  isComparisonEvaluator,
  type EvaluationsV3State,
  type EvaluationV3Event,
  type ESBatchEvaluationTarget,
  type ExecutionCell,
  type ExperimentService,
} from "@langwatch/experiment-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { ExperimentEvaluationReportingPort } from "../ports/experiment-evaluation-reporting.port";
import type { LoadedEvaluators } from "./experiment-execution-data.service";
import type { SeededTargetOutput } from "./experiment-cell-plan.service";
import type { VariantEvaluatorScore } from "./experiment-comparison-plan.service";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service";

const logger = createLogger("langwatch:experiment:run-orchestrator");

const EVALUATION_KSUID_RESOURCE = "eval";

export class ExperimentRunStorageService {
  static create({
    commands,
    evaluationReporting,
    dispatches,
    cells,
    seedTargetOutputs,
  }: {
    commands: ExperimentService;
    evaluationReporting: ExperimentEvaluationReportingPort;
    dispatches: ExperimentResultDispatchService;
    cells: ExecutionCell[];
    seedTargetOutputs?: Record<string, SeededTargetOutput>;
  }): ExperimentRunStorageService {
    const cellTraceIds = new Map<string, string>();
    for (const cell of cells) {
      if (cell.traceId) {
        cellTraceIds.set(`${cell.rowIndex}:${cell.targetId}`, cell.traceId);
      }
    }

    const completedTargetOutputs = new Map<string, SeededTargetOutput>();
    if (seedTargetOutputs) {
      for (const [key, value] of Object.entries(seedTargetOutputs)) {
        completedTargetOutputs.set(key, value);
      }
    }

    return new ExperimentRunStorageService(
      commands,
      evaluationReporting,
      dispatches,
      cellTraceIds,
      completedTargetOutputs,
    );
  }

  private chDispatchFailures = 0;
  private chDispatchTotal = 0;
  private readonly producedTargetKeys = new Set<string>();
  private readonly completedTargetEvaluatorScores = new Map<string, VariantEvaluatorScore[]>();

  private constructor(
    private readonly commands: ExperimentService,
    private readonly evaluationReporting: ExperimentEvaluationReportingPort,
    private readonly dispatches: ExperimentResultDispatchService,
    private readonly cellTraceIds: Map<string, string>,
    private readonly completedTargetOutputs: Map<string, SeededTargetOutput>,
  ) {}

  get outputs(): Map<string, SeededTargetOutput> {
    return this.completedTargetOutputs;
  }

  get evaluatorScores(): Map<string, VariantEvaluatorScore[]> {
    return this.completedTargetEvaluatorScores;
  }

  get dispatchFailures(): number {
    return this.chDispatchFailures;
  }

  get dispatchTotal(): number {
    return this.chDispatchTotal;
  }

  hasProduced(key: string): boolean {
    return this.producedTargetKeys.has(key);
  }

  /** Dispatches the run's start to ClickHouse. Throws on failure, having already logged and counted it. */
  async startRun({
    projectId,
    runId,
    experimentId,
    workflowVersionId,
    totalCells,
    targets,
  }: {
    projectId: string;
    runId: string;
    experimentId: string;
    workflowVersionId: string | undefined;
    totalCells: number;
    targets: ESBatchEvaluationTarget[];
  }): Promise<void> {
    this.chDispatchTotal++;
    try {
      await this.commands.startExperimentRun({
        tenantId: projectId,
        runId,
        experimentId,
        workflowVersionId: workflowVersionId ?? null,
        total: totalCells,
        targets,
        occurredAt: Date.now(),
      });
    } catch (err) {
      this.chDispatchFailures++;
      logger.error({ err, runId }, "Failed to dispatch startExperimentRun to CH");
      throw err;
    }
  }

  /** Dispatches the run's completion to ClickHouse. Never throws — a failure here is logged and counted, not fatal. */
  async completeRun({
    projectId,
    runId,
    experimentId,
    aborted,
    finishedAt,
  }: {
    projectId: string;
    runId: string;
    experimentId: string;
    aborted: boolean;
    finishedAt: number;
  }): Promise<void> {
    this.chDispatchTotal++;
    await this.commands
      .completeExperimentRun({
        tenantId: projectId,
        runId,
        experimentId,
        finishedAt: aborted ? null : finishedAt,
        stoppedAt: aborted ? finishedAt : null,
        occurredAt: Date.now(),
      })
      .catch((err) => {
        this.chDispatchFailures++;
        logger.warn({ err, runId }, "Failed to dispatch completeExperimentRun to CH");
      });
  }

  /**
   * Mirrors one execution event: caches its traceId/output/scores for Phase
   * 2, reports it to the evaluation pipeline, and dispatches it to
   * ClickHouse when the run is CH-backed (`experimentId` given).
   */
  async record({
    event,
    projectId,
    runId,
    experimentId,
    state,
    loadedEvaluators,
    datasetRows,
  }: {
    event: EvaluationV3Event;
    projectId: string;
    runId: string;
    experimentId: string | undefined;
    state: EvaluationsV3State;
    loadedEvaluators: LoadedEvaluators | undefined;
    datasetRows: Array<Record<string, unknown>>;
  }): Promise<void> {
    if (event.type === "target_result" && event.traceId) {
      this.cellTraceIds.set(`${event.rowIndex}:${event.targetId}`, event.traceId);
    }

    if (
      event.type === "target_result" &&
      !event.error &&
      event.output !== null &&
      event.output !== undefined
    ) {
      this.completedTargetOutputs.set(`${event.rowIndex}:${event.targetId}`, {
        output: event.output,
        cost: event.cost ?? undefined,
        duration: event.duration ?? undefined,
      });
      this.producedTargetKeys.add(`${event.rowIndex}:${event.targetId}`);
    }

    if (event.type === "evaluator_result") {
      const evalResult = event.result as SingleEvaluationResult;
      const evaluatorConfig = state.evaluators.find((e) => e.id === event.evaluatorId);

      // Cache per-(row, target) evaluator scores for the Phase 2 judge.
      // Skip comparison evaluators themselves — a comparison judge reading
      // another comparison's verdict is circular.
      if (
        evalResult.status === "processed" &&
        evaluatorConfig &&
        !isComparisonEvaluator(evaluatorConfig)
      ) {
        const dbEval = evaluatorConfig.dbEvaluatorId
          ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
          : null;
        const name =
          dbEval?.name ?? evaluatorConfig.evaluatorType?.split("/").pop() ?? evaluatorConfig.id;
        const key = `${event.rowIndex}:${event.targetId}`;
        const arr = this.completedTargetEvaluatorScores.get(key) ?? [];
        arr.push({
          name,
          score: evalResult.score ?? undefined,
          label: evalResult.label ?? undefined,
          passed: evalResult.passed ?? undefined,
        });
        this.completedTargetEvaluatorScores.set(key, arr);
      }
      const dbEvaluator = evaluatorConfig?.dbEvaluatorId
        ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
        : null;
      const traceId = this.cellTraceIds.get(`${event.rowIndex}:${event.targetId}`);
      const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
      try {
        await this.evaluationReporting.reportEvaluation({
          tenantId: projectId,
          evaluationId,
          evaluatorId: event.evaluatorId,
          evaluatorType: evaluatorConfig?.evaluatorType ?? "unknown",
          evaluatorName: dbEvaluator?.name,
          traceId,
          status: evalResult.status,
          score: evalResult.status === "processed" ? (evalResult.score ?? undefined) : undefined,
          passed: evalResult.status === "processed" ? (evalResult.passed ?? undefined) : undefined,
          // For pairwise verdicts, langevals now returns the winner's
          // candidate id (or "tie") directly in `label`. No translation
          // needed here; SDK / REST / MCP consumers see the winner by id.
          label: evalResult.status === "processed" ? (evalResult.label ?? undefined) : undefined,
          details:
            evalResult.status === "processed" ? (evalResult.details ?? undefined) : undefined,
          error: evalResult.status === "error" ? evalResult.details : undefined,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.error(
          { error, evaluationId, evaluatorId: event.evaluatorId },
          "Failed to dispatch evaluator result to evaluation processing pipeline",
        );
      }
    }

    if (experimentId) {
      const targetResultDispatch =
        event.type === "target_result" || event.type === "error"
          ? this.dispatches.tryBuildTargetResultDispatch({
              tenantId: projectId,
              runId,
              experimentId,
              event,
              datasetEntry: event.rowIndex !== undefined ? (datasetRows[event.rowIndex] ?? {}) : {},
              occurredAt: Date.now(),
            })
          : null;

      if (targetResultDispatch) {
        this.chDispatchTotal++;
        await this.commands.recordTargetResult(targetResultDispatch).catch((err) => {
          this.chDispatchFailures++;
          logger.warn({ err, runId }, "Failed to dispatch recordTargetResult to CH");
        });
      } else if (event.type === "evaluator_result") {
        const result = event.result as SingleEvaluationResult;
        const evaluatorConfig = state.evaluators.find((e) => e.id === event.evaluatorId);
        const dbEvaluator = evaluatorConfig?.dbEvaluatorId
          ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
          : null;
        this.chDispatchTotal++;
        await this.commands
          .recordEvaluatorResult(
            this.dispatches.buildEvaluatorResultDispatch({
              tenantId: projectId,
              runId,
              experimentId,
              event,
              result,
              // Workflow evaluator nodes have no DB record, so fall back to
              // the name the event carries from the DSL node.
              evaluatorName: dbEvaluator?.name ?? event.evaluatorName ?? null,
              occurredAt: Date.now(),
            }),
          )
          .catch((err) => {
            this.chDispatchFailures++;
            logger.warn({ err, runId }, "Failed to dispatch recordEvaluatorResult to CH");
          });
      }
    }
  }
}
