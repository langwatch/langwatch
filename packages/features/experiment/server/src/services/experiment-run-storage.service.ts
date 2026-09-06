/**
 * Everything a run writes to ClickHouse as it executes: the run lifecycle
 * dispatches, the per-event `record`, and the per-(row, target) caches
 * Phase 2 comparison cells read.
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
import type { ExperimentEvaluationReportingPort } from "../ports/experiment-evaluation-reporting.port.ts";
import type { LoadedEvaluators } from "./experiment-execution-data.service.ts";
import type { SeededTargetOutput } from "./experiment-cell-plan.service.ts";
import type { VariantEvaluatorScore } from "./experiment-comparison-plan.service.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";

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

  /** Dispatches the run's start to ClickHouse. Throws on failure, after logging and counting it. */
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

  /** Dispatches the run's completion to ClickHouse. Never throws: failures are logged. */
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
    if (event.type === "target_result") {
      this.rememberTargetResult(event);
    }

    if (event.type === "evaluator_result") {
      await this.reportEvaluatorResult({ event, projectId, state, loadedEvaluators });
    }

    if (experimentId) {
      await this.dispatchToClickHouse({
        event,
        projectId,
        runId,
        experimentId,
        state,
        loadedEvaluators,
        datasetRows,
      });
    }
  }

  /** What a completed target leaves behind for the comparison judge and for later evaluators. */
  private rememberTargetResult(event: EvaluationV3Event & { type: "target_result" }): void {
    const key = `${event.rowIndex}:${event.targetId}`;
    if (event.traceId) {
      this.cellTraceIds.set(key, event.traceId);
    }

    if (event.error || event.output === null || event.output === undefined) {
      return;
    }

    this.completedTargetOutputs.set(key, {
      output: event.output,
      cost: event.cost ?? undefined,
      duration: event.duration ?? undefined,
    });
    this.producedTargetKeys.add(key);
  }

  /**
   * One evaluator verdict, cached for the comparison judge and reported to the evaluation
   * pipeline. A comparison evaluator's own verdict is not cached: a comparison judge reading
   * another comparison's verdict is circular.
   */
  private async reportEvaluatorResult({
    event,
    projectId,
    state,
    loadedEvaluators,
  }: {
    event: EvaluationV3Event & { type: "evaluator_result" };
    projectId: string;
    state: EvaluationsV3State;
    loadedEvaluators: LoadedEvaluators | undefined;
  }): Promise<void> {
    const evalResult = event.result as SingleEvaluationResult;
    const evaluatorConfig = state.evaluators.find((e) => e.id === event.evaluatorId);
    const dbEvaluator = evaluatorConfig?.dbEvaluatorId
      ? loadedEvaluators?.get(evaluatorConfig.dbEvaluatorId)
      : null;
    if (
      evalResult.status === "processed" &&
      evaluatorConfig &&
      !isComparisonEvaluator(evaluatorConfig)
    ) {
      const name =
        dbEvaluator?.name ?? evaluatorConfig.evaluatorType?.split("/").pop() ?? evaluatorConfig.id;
      const key = `${event.rowIndex}:${event.targetId}`;
      const scores = this.completedTargetEvaluatorScores.get(key) ?? [];
      scores.push({
        name,
        score: evalResult.score ?? undefined,
        label: evalResult.label ?? undefined,
        passed: evalResult.passed ?? undefined,
      });
      this.completedTargetEvaluatorScores.set(key, scores);
    }

    const processed = evalResult.status === "processed";
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
    try {
      await this.evaluationReporting.reportEvaluation({
        tenantId: projectId,
        evaluationId,
        evaluatorId: event.evaluatorId,
        evaluatorType: evaluatorConfig?.evaluatorType ?? "unknown",
        evaluatorName: dbEvaluator?.name,
        traceId: this.cellTraceIds.get(`${event.rowIndex}:${event.targetId}`),
        status: evalResult.status,
        score: processed ? (evalResult.score ?? undefined) : undefined,
        passed: processed ? (evalResult.passed ?? undefined) : undefined,
        // For pairwise verdicts langevals returns the winner's candidate id, or "tie", directly in
        // `label`, so no translation happens here: consumers see the winner by id.
        label: processed ? (evalResult.label ?? undefined) : undefined,
        details: processed ? (evalResult.details ?? undefined) : undefined,
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

  /** The same event as a ClickHouse row, best-effort: a failed dispatch is counted and logged. */
  private async dispatchToClickHouse({
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
    experimentId: string;
    state: EvaluationsV3State;
    loadedEvaluators: LoadedEvaluators | undefined;
    datasetRows: Array<Record<string, unknown>>;
  }): Promise<void> {
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

      return;
    }

    if (event.type !== "evaluator_result") {
      return;
    }

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
          result: event.result as SingleEvaluationResult,
          // Workflow evaluator nodes have no database record, so the name the event carries from
          // the DSL node stands in.
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
