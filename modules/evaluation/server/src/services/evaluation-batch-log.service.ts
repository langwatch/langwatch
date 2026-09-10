/**
 * One SDK batch evaluation, recorded: its experiment, its run, its target and
 * evaluator rows, and the verdicts it puts on the processing pipeline.
 * @see specs/monitors/guardrails-api-compatibility.feature
 */
import type {
  EvaluationSlugLookup,
  EvaluationSlugMatch,
  LogBatchEvaluationInput,
} from "@langwatch/evaluation-contract";
import {
  eSBatchEvaluationSchema,
  mapLegacyExperimentTargets,
  type ESBatchEvaluation,
  type ExperimentRunCommandTarget,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { EvaluationReport } from "../app/evaluation.infrastructure.ts";
import { gatedVerdictFields, processTargets } from "../rules/evaluation-dispatch.rules.ts";

const logger = createLogger("langwatch:evaluation:batch-log");

/** The experiment an SDK batch's rows are grouped under, found or created. */
export interface EvaluationExperimentDirectory {
  findOrCreate(input: {
    projectId: string;
    experimentId?: string | undefined;
    experimentSlug?: string | undefined;
    experimentType: "BATCH_EVALUATION_V2";
    experimentName?: string | undefined;
    workflowId?: string | undefined;
  }): Promise<EvaluationSlugMatch>;
  findBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
}

/** The run history an SDK batch is written into, one call per phase. */
export interface EvaluationExperimentRunWriter {
  startRun(input: {
    tenantId: string;
    runId: string;
    experimentId: string;
    total: number;
    targets: ExperimentRunCommandTarget[];
    occurredAt: number;
  }): Promise<unknown>;
  recordTargetResult(input: {
    tenantId: string;
    runId: string;
    experimentId: string;
    index: number;
    targetId: string;
    entry: Record<string, unknown>;
    predicted?: Record<string, unknown> | undefined;
    cost?: number | undefined;
    duration?: number | undefined;
    error?: string | undefined;
    traceId?: string | undefined;
    targets: ExperimentRunCommandTarget[];
    occurredAt: number;
  }): Promise<unknown>;
  recordEvaluatorResult(input: {
    tenantId: string;
    runId: string;
    experimentId: string;
    index: number;
    targetId: string;
    evaluatorId: string;
    evaluatorName?: string | undefined;
    status: string;
    score?: number | undefined;
    label?: string | undefined;
    passed?: boolean | undefined;
    details?: string | undefined;
    cost?: number | undefined;
    inputs?: Record<string, unknown> | undefined;
    duration?: number | undefined;
    occurredAt: number;
  }): Promise<unknown>;
  completeRun(input: {
    tenantId: string;
    runId: string;
    experimentId: string;
    finishedAt?: number | undefined;
    stoppedAt?: number | undefined;
    occurredAt: number;
  }): Promise<unknown>;
}

/** What one batch's rows are written through. */
export type EvaluationBatchLogDeps = Readonly<{
  experiments: EvaluationExperimentDirectory;
  runs: EvaluationExperimentRunWriter;
  report: EvaluationReport;
}>;

export class EvaluationBatchLogService {
  static create(deps: EvaluationBatchLogDeps): EvaluationBatchLogService {
    return new EvaluationBatchLogService(deps);
  }

  private constructor(private readonly deps: EvaluationBatchLogDeps) {}

  /**
   * The experiment is resolved first, because every row below is written
   * against its id; the schema then validates the whole batch before a single
   * row is dispatched.
   */
  async log({ projectId, params }: LogBatchEvaluationInput): Promise<void> {
    const experiment = await this.deps.experiments.findOrCreate({
      projectId,
      experimentId: params.experiment_id ?? undefined,
      experimentSlug: params.experiment_slug ?? undefined,
      experimentType: "BATCH_EVALUATION_V2",
      experimentName: params.name ?? undefined,
      workflowId: params.workflow_id ?? undefined,
    });

    const batchEvaluation: ESBatchEvaluation = {
      ...params,
      experiment_id: experiment.id,
      project_id: projectId,
      targets: processTargets(params.targets),
      dataset: params.dataset ?? [],
      evaluations: params.evaluations ?? [],
      timestamps: {
        ...params.timestamps,
        created_at: params.timestamps?.created_at ?? nowInstant().epochMilliseconds,
        inserted_at: nowInstant().epochMilliseconds,
        updated_at: nowInstant().epochMilliseconds,
      },
    };

    eSBatchEvaluationSchema.parse(batchEvaluation);

    await this.#dispatch({ projectId, experimentId: experiment.id, batchEvaluation });
  }

  async #dispatch({
    projectId,
    experimentId,
    batchEvaluation,
  }: {
    projectId: string;
    experimentId: string;
    batchEvaluation: ESBatchEvaluation;
  }): Promise<void> {
    const { run_id: runId } = batchEvaluation;
    const targets = mapLegacyExperimentTargets(batchEvaluation.targets ?? []);

    try {
      await this.deps.runs.startRun({
        tenantId: projectId,
        runId,
        experimentId,
        total: batchEvaluation.total || batchEvaluation.dataset.length,
        targets,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error({ error, runId, projectId }, "Failed to dispatch startExperimentRun to CH");

      throw error;
    }

    await Promise.all([
      ...batchEvaluation.dataset.map((entry) =>
        this.deps.runs
          .recordTargetResult({
            tenantId: projectId,
            runId,
            experimentId,
            index: entry.index,
            targetId: entry.target_id ?? "",
            entry: entry.entry,
            predicted: entry.predicted ?? undefined,
            cost: entry.cost ?? undefined,
            duration: entry.duration ?? undefined,
            error: entry.error ?? undefined,
            traceId: entry.trace_id ?? undefined,
            targets,
            occurredAt: nowInstant().epochMilliseconds,
          })
          .catch((err: unknown) => {
            logger.warn(
              { err, runId, index: entry.index, targetId: entry.target_id },
              "Failed to dispatch recordTargetResult to CH",
            );
          }),
      ),
      ...batchEvaluation.evaluations.map((evaluation) =>
        this.deps.runs
          .recordEvaluatorResult({
            tenantId: projectId,
            runId,
            experimentId,
            index: evaluation.index,
            targetId: evaluation.target_id ?? "",
            evaluatorId: evaluation.evaluator,
            evaluatorName: evaluation.name ?? undefined,
            status: evaluation.status,
            score: typeof evaluation.score === "number" ? evaluation.score : undefined,
            label: evaluation.label ?? undefined,
            passed: evaluation.passed ?? undefined,
            details: evaluation.details ?? undefined,
            cost: evaluation.cost ?? undefined,
            inputs: evaluation.inputs ?? undefined,
            duration: typeof evaluation.duration === "number" ? evaluation.duration : undefined,
            occurredAt: nowInstant().epochMilliseconds,
          })
          .catch((err: unknown) => {
            logger.warn(
              { err, runId, index: evaluation.index, evaluator: evaluation.evaluator },
              "Failed to dispatch recordEvaluatorResult to CH",
            );
          }),
      ),
    ]);

    await this.#completeRun({ projectId, experimentId, batchEvaluation });
    await this.#reportVerdicts({ projectId, batchEvaluation });
  }

  /** A batch that reported a finish or a stop closes its run; one still going does not. */
  async #completeRun({
    projectId,
    experimentId,
    batchEvaluation,
  }: {
    projectId: string;
    experimentId: string;
    batchEvaluation: ESBatchEvaluation;
  }): Promise<void> {
    const { finished_at: finishedAt, stopped_at: stoppedAt } = batchEvaluation.timestamps;

    if (!finishedAt && !stoppedAt) return;

    try {
      await this.deps.runs.completeRun({
        tenantId: projectId,
        runId: batchEvaluation.run_id,
        experimentId,
        finishedAt: finishedAt ?? undefined,
        stoppedAt: stoppedAt ?? undefined,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn(
        { error, runId: batchEvaluation.run_id, projectId },
        "Failed to dispatch completeExperimentRun to CH",
      );
    }
  }

  /** The same pipeline every other verdict travels on, one row at a time. */
  async #reportVerdicts({
    projectId,
    batchEvaluation,
  }: {
    projectId: string;
    batchEvaluation: ESBatchEvaluation;
  }): Promise<void> {
    const { run_id: runId } = batchEvaluation;

    await Promise.all(
      batchEvaluation.evaluations.map((evaluation) => {
        const targetId = evaluation.target_id ?? "";
        const evaluationId = `local_eval_${runId}_${evaluation.evaluator}_${evaluation.index}_${targetId}`;

        return this.deps.report
          .reportEvaluation({
            tenantId: projectId,
            evaluationId,
            evaluatorId: evaluation.evaluator,
            evaluatorType: evaluation.evaluator,
            evaluatorName: evaluation.name ?? undefined,
            status: evaluation.status,
            ...gatedVerdictFields(evaluation),
            details: evaluation.details ?? undefined,
            occurredAt: nowInstant().epochMilliseconds,
          })
          .catch((err: unknown) => {
            logger.warn(
              { err, evaluationId, evaluator: evaluation.evaluator },
              "Failed to dispatch evaluation to evaluation processing pipeline",
            );
          });
      }),
    );
  }
}
