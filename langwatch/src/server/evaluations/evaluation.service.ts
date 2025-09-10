import { fromZodError } from "zod-validation-error";
import { createLogger } from "~/utils/logger";
import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { ZodError, type z } from "zod";

import { updateEvaluationStatusInES } from "~/server/background/queues/evaluationsQueue";
import { evaluationNameAutoslug } from "~/server/background/workers/collector/evaluations";
import {
  runEvaluation,
  type DataForEvaluation,
} from "~/server/background/workers/evaluationsWorker";
import {
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "./evaluators.generated";
import {
  evaluatorsSchema,
  type singleEvaluationResultSchema,
} from "./evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "./getEvaluator";
import { evaluationInputSchema, type EvaluationRESTParams } from "./types";
import {
  getEvaluatorDataForParams,
  getEvaluatorIncludingCustom,
} from "./utils";
import { type EvaluationRepository } from "./repositories/evaluation.repository";

const logger = createLogger("langwatch:evaluations:service");

export interface EvaluationServiceOptions {
  projectId: string;
  evaluatorSlug: string;
  params: EvaluationRESTParams;
  asGuardrail?: boolean;
}

export class EvaluationService {
  constructor(private readonly evaluationRepository: EvaluationRepository) {}

  /**
   * Run an evaluation with the given parameters
   */
  async runEvaluation(
    options: EvaluationServiceOptions
  ): Promise<z.infer<typeof singleEvaluationResultSchema>> {
    const { projectId, evaluatorSlug, params, asGuardrail = false } = options;

    logger.info({ projectId, evaluatorSlug }, "Starting evaluation");

    // Validate input parameters
    let validatedParams: EvaluationRESTParams;
    try {
      validatedParams = evaluationInputSchema.parse(params);
    } catch (error) {
      logger.error(
        { error, projectId, paramKeys: Object.keys(params ?? {}) },
        "Invalid evaluation params received"
      );
      const validationError = fromZodError(error as ZodError);
      Sentry.captureException(error, {
        extra: {
          projectId,
          validationError: validationError.message,
        },
      });
      throw new Error(
        `Invalid evaluation parameters: ${validationError.message}`
      );
    }

    const isGuardrail = Boolean(asGuardrail || validatedParams.as_guardrail);

    // Get evaluator slug and check type
    const checkType = await this.getEvaluatorCheckType(
      projectId,
      evaluatorSlug
    );

    // Get evaluator definition
    const evaluatorDefinition = await getEvaluatorIncludingCustom(
      projectId,
      checkType as EvaluatorTypes
    );
    if (!evaluatorDefinition) {
      throw new Error(`Evaluator not found: ${checkType}`);
    }

    // Get stored evaluator if it exists
    const storedEvaluator = await this.getStoredEvaluator(
      projectId,
      evaluatorSlug
    );

    // Check if guardrail is enabled
    if (storedEvaluator && !storedEvaluator.enabled && !!isGuardrail) {
      return {
        status: "skipped",
        details: `Guardrail is not enabled`,
        ...(isGuardrail ? { passed: true } : {}),
      };
    }

    // Prepare settings
    const settings = await this.prepareEvaluatorSettings(
      checkType,
      storedEvaluator,
      validatedParams,
      evaluatorDefinition
    );

    // Prepare evaluation data
    const data = await this.prepareEvaluationData(checkType, validatedParams);

    // Validate required fields
    this.validateRequiredFields(data, evaluatorDefinition);

    // Run the evaluation
    const result = await this.executeEvaluation(
      projectId,
      checkType,
      data,
      settings
    );

    // Handle costs
    const cost = await this.handleCosts(
      projectId,
      result,
      storedEvaluator,
      checkType,
      isGuardrail,
      validatedParams
    );

    // Update evaluation status in Elasticsearch
    await this.updateEvaluationStatus(
      projectId,
      result,
      storedEvaluator,
      checkType,
      isGuardrail,
      validatedParams
    );

    // Prepare final result
    const finalResult = this.prepareFinalResult(result, isGuardrail);

    return finalResult;
  }

  private async getEvaluatorCheckType(
    projectId: string,
    evaluatorSlug: string
  ): Promise<string> {
    const storedEvaluator = await this.evaluationRepository.findStoredEvaluator(
      projectId,
      evaluatorSlug
    );
    return storedEvaluator?.checkType ?? evaluatorSlug;
  }

  private async getStoredEvaluator(projectId: string, evaluatorSlug: string) {
    return await this.evaluationRepository.findStoredEvaluator(
      projectId,
      evaluatorSlug
    );
  }

  private async prepareEvaluatorSettings(
    checkType: string,
    storedEvaluator: any,
    params: EvaluationRESTParams,
    evaluatorDefinition: any
  ) {
    const evaluatorSettingSchema = checkType.startsWith("custom/")
      ? undefined
      : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;

    let settings:
      | z.infer<NonNullable<typeof evaluatorSettingSchema>>
      | undefined =
      (storedEvaluator?.parameters as z.infer<
        NonNullable<typeof evaluatorSettingSchema>
      >) ?? {};

    try {
      settings = evaluatorSettingSchema?.parse({
        ...getEvaluatorDefaultSettings(evaluatorDefinition),
        ...(storedEvaluator ? (storedEvaluator.parameters as object) : {}),
        ...(params.settings ? params.settings : {}),
      });
    } catch (error) {
      logger.error(
        { error, params, checkType },
        "Invalid settings received for the evaluator"
      );
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        Sentry.captureException(error, {
          extra: { params, validationError: validationError.message },
        });
        throw new Error(
          `Invalid settings for ${checkType} evaluator: ${validationError.message}`
        );
      }
      Sentry.captureException(error);
      throw new Error(
        error instanceof Error ? error.message : "Invalid evaluator settings"
      );
    }

    return settings;
  }

  private async prepareEvaluationData(
    checkType: string,
    params: EvaluationRESTParams
  ): Promise<DataForEvaluation> {
    try {
      return getEvaluatorDataForParams(
        checkType,
        params.data as Record<string, any>
      );
    } catch (error) {
      logger.error({ error, params }, "Invalid evaluation data received");

      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        Sentry.captureException(error, {
          extra: { validationError: validationError.message },
        });
        throw new Error(validationError.message);
      }

      Sentry.captureException(error);
      throw new Error(
        error instanceof Error ? error.message : "Invalid evaluation data"
      );
    }
  }

  private validateRequiredFields(
    data: DataForEvaluation,
    evaluatorDefinition: any
  ) {
    for (const requiredField of evaluatorDefinition.requiredFields) {
      if (
        data.data[requiredField] === undefined ||
        data.data[requiredField] === null
      ) {
        throw new Error(
          `${requiredField} is required for ${evaluatorDefinition.name} evaluator`
        );
      }
    }
  }

  private async executeEvaluation(
    projectId: string,
    checkType: string,
    data: DataForEvaluation,
    settings: any
  ): Promise<SingleEvaluationResult> {
    const runEval = () =>
      runEvaluation({
        projectId,
        evaluatorType: checkType as EvaluatorTypes,
        data,
        settings,
      });

    try {
      let result = await runEval();

      // Retry once in case of timeout error
      if (
        result.status === "error" &&
        (result.error_type === "TIMEOUT" ||
          (typeof result.details === "string" &&
            result.details.toLowerCase().includes("timed out")))
      ) {
        result = await runEval();
      }

      return result;
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          projectId,
          checkType,
        },
      });
      logger.error({ error, projectId, checkType }, "Error running evaluation");
      return {
        status: "error",
        error_type: "INTERNAL_ERROR",
        details: "Internal error",
        traceback: [],
      };
    }
  }

  private async handleCosts(
    projectId: string,
    result: SingleEvaluationResult,
    storedEvaluator: any,
    checkType: string,
    isGuardrail: boolean,
    params: EvaluationRESTParams
  ) {
    if ("cost" in result && result.cost) {
      await this.evaluationRepository.createCost({
        id: `cost_${nanoid()}`,
        projectId,
        costType: isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
        costName: storedEvaluator?.name ?? checkType,
        referenceType: CostReferenceType.CHECK,
        referenceId: storedEvaluator?.id ?? checkType,
        amount: result.cost.amount,
        currency: result.cost.currency,
        extraInfo: {
          trace_id: params.trace_id,
        },
      });

      return result.cost;
    }

    return undefined;
  }

  private async updateEvaluationStatus(
    projectId: string,
    result: SingleEvaluationResult,
    storedEvaluator: any,
    checkType: string,
    isGuardrail: boolean,
    params: EvaluationRESTParams
  ) {
    if (params.trace_id) {
      await updateEvaluationStatusInES({
        check: {
          evaluation_id:
            storedEvaluator?.id ?? params.evaluation_id ?? `eval_${nanoid()}`,
          evaluator_id:
            storedEvaluator?.id ??
            params.evaluator_id ??
            evaluationNameAutoslug(params.name ?? checkType),
          type: checkType as EvaluatorTypes,
          name: storedEvaluator?.name ?? params.name ?? checkType,
        },
        trace: {
          trace_id: params.trace_id,
          project_id: projectId,
        },
        status: result.status,
        is_guardrail: isGuardrail ? true : undefined,
        ...(result.status === "error"
          ? {
              error: {
                details: result.details,
                stack: result.traceback,
              },
            }
          : {}),
        ...(result.status === "processed"
          ? {
              score: result.score,
              passed: result.passed,
              label: result.label,
            }
          : {}),
        details: "details" in result ? (result.details ?? "") : "",
      });
    }
  }

  private prepareFinalResult(
    result: SingleEvaluationResult,
    isGuardrail: boolean
  ): z.infer<typeof singleEvaluationResultSchema> {
    if (result.status === "error") {
      return {
        status: "error",
        error_type:
          "error_type" in result ? result.error_type : "EVALUATOR_ERROR",
        details: result.details,
        traceback: result.traceback,
        // Don't set passed: true for error statuses to avoid confusion
        // The comment suggests this was to avoid failing guardrails due to evaluator bugs,
        // but this creates confusing responses where status is "error" but passed is "true"
      };
    } else if (result.status === "skipped") {
      return {
        status: "skipped",
        details: result.details,
        ...(isGuardrail ? { passed: true } : {}),
      };
    } else {
      return {
        ...result,
        ...(isGuardrail ? { passed: result.passed ?? true } : {}),
      };
    }
  }
}
