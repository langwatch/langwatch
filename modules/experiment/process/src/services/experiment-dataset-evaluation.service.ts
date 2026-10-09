/**
 * One SDK dataset evaluation: the evaluator runs over an entry of a saved
 * dataset, and its cost and row are recorded against the named experiment.
 * @see modules/experiment/specs/experiment-dataset-evaluation.feature
 */
import {
  EvaluationRestExperimentNotFoundError,
  getEvaluatorDataForParams,
  getEvaluatorIncludingCustom,
  type EvaluationApi,
  type EvaluationDispatchData,
  type EvaluatorIncludingCustom,
} from "@langwatch/evaluation-contract";
import type {
  EvaluationResult,
  EvaluatorTypes,
  SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type {
  DatasetEvaluationInput,
  DatasetEvaluationOutcome,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { getWorkflowsRequiredFields } from "@langwatch/workflow-contract";
import { fromZodError, isZodErrorLike } from "zod-validation-error";

import type { ExperimentService } from "./experiment.service.ts";

const logger = createLogger("langwatch:experiment:dataset-evaluation");

/** A throwaway slug, minted only when the caller named none: a lookup that always misses. */
const LEGACY_EVAL_SLUG_KSUID_PREFIX = "evalslug";
const COST_KSUID_PREFIX = "cost";
const BATCH_EVALUATION_KSUID_PREFIX = "batchevaluation";

/** What one dataset evaluation reads and writes. */
type ExperimentDatasetEvaluationDeps = Readonly<{
  /** The experiment the results are grouped under. */
  experiments: Pick<ExperimentService, "findBySlug">;
  /** The evaluator, the dataset, the run, the cost ledger and the row, all evaluation's. */
  evaluation: Pick<
    EvaluationApi,
    | "findMonitorBySlug"
    | "listCustomEvaluators"
    | "findDatasetBySlug"
    | "runEvaluator"
    | "recordEvaluationCost"
    | "recordDatasetEvaluationRow"
  >;
}>;

export class ExperimentDatasetEvaluationService {
  static create(deps: ExperimentDatasetEvaluationDeps): ExperimentDatasetEvaluationService {
    return new ExperimentDatasetEvaluationService(deps);
  }

  private constructor(private readonly deps: ExperimentDatasetEvaluationDeps) {}

  /**
   * Main's order: the evaluator and data refusals, the dataset, the run, and
   * only then the experiment, whose absence is thrown after the run.
   */
  async evaluate(input: DatasetEvaluationInput): Promise<DatasetEvaluationOutcome> {
    const { projectId, evaluation, datasetSlug } = input;
    const { evaluation: evaluations } = this.deps;
    const experimentSlug =
      input.experimentSlug ?? generate(LEGACY_EVAL_SLUG_KSUID_PREFIX).toString();
    const monitor = await evaluations.findMonitorBySlug({ projectId, slug: evaluation });
    const checkType = monitor?.checkType ?? evaluation;

    const evaluator = await this.findEvaluator({ projectId, checkType });
    if (!evaluator) return { outcome: "evaluator_not_found", checkType };

    let data: EvaluationDispatchData;
    try {
      data = getEvaluatorDataForParams(checkType, input.data);
    } catch (error) {
      logger.error({ error, projectId }, "invalid evaluation data received");

      return { outcome: "invalid_data", sentence: sentenceFor(error) };
    }

    if (!evaluator.requiredFields.every((field: string) => field in data.data)) {
      return { outcome: "missing_field", checkType, requiredFields: evaluator.requiredFields };
    }

    const dataset = await evaluations.findDatasetBySlug({ projectId, slug: datasetSlug });
    if (!dataset) return { outcome: "dataset_not_found" };

    const result = await runOrReportInternalError(() =>
      evaluations.runEvaluator({
        projectId,
        data,
        evaluatorType: checkType,
        settings: (monitor?.parameters as Record<string, unknown> | undefined) ?? {},
      }),
    );

    const experiment = await this.deps.experiments.findBySlug({
      projectId,
      slug: experimentSlug,
    });
    if (!experiment) throw new EvaluationRestExperimentNotFoundError(experimentSlug);

    if ("cost" in result && result.cost) {
      await evaluations.recordEvaluationCost({
        id: generate(COST_KSUID_PREFIX).toString(),
        projectId,
        costType: "BATCH_EVALUATION",
        costName: evaluation,
        referenceType: "BATCH",
        referenceId: experiment.id,
        amount: result.cost.amount,
        currency: result.cost.currency,
      });
    }

    const { score, passed, details, cost, status, label } = result as EvaluationResult;

    await evaluations.recordDatasetEvaluationRow({
      id: generate(BATCH_EVALUATION_KSUID_PREFIX).toString(),
      experimentId: experiment.id,
      projectId,
      data: data.data,
      status,
      score: score ?? 0,
      passed: passed ?? false,
      label: label ?? null,
      details: details ?? "",
      cost: cost?.amount ?? 0,
      evaluation,
      datasetSlug,
      datasetId: dataset.id,
    });

    return { outcome: "evaluated", result };
  }

  /** The evaluator a type names, or nothing when neither built-in nor custom has it. */
  private async findEvaluator({
    projectId,
    checkType,
  }: {
    projectId: string;
    checkType: string;
  }): Promise<EvaluatorIncludingCustom | undefined> {
    const customEvaluators = await this.deps.evaluation.listCustomEvaluators({ projectId });

    try {
      return getEvaluatorIncludingCustom({
        checkType: checkType as EvaluatorTypes,
        customEvaluators: getWorkflowsRequiredFields({ workflows: customEvaluators }),
      });
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "evaluator_not_found") return undefined;
      throw error;
    }
  }
}

/** A run that threw is an errored result, not a refusal. */
async function runOrReportInternalError(
  run: () => Promise<SingleEvaluationResult>,
): Promise<SingleEvaluationResult> {
  try {
    return await run();
  } catch (error) {
    return {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details: error instanceof Error ? error.message : "Internal error",
      traceback: [],
    };
  }
}

/** A refusal's sentence, whichever kind of failure produced it. */
function sentenceFor(error: unknown): string {
  if (isZodErrorLike(error)) return fromZodError(error).message;
  if (error instanceof Error) return error.message;

  return String(error);
}
