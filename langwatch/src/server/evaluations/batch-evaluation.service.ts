import { type ZodError } from "zod-validation-error";
import { createLogger } from "~/utils/logger";
import type {
  ESBatchEvaluation,
  ESBatchEvaluationRESTParams,
} from "~/server/experiments/types";
import {
  eSBatchEvaluationRESTParamsSchema,
} from "~/server/experiments/types.generated";
import * as Sentry from "@sentry/nextjs";
import { fromZodError } from "zod-validation-error";
import { ExperimentType } from "@prisma/client";
import { getPayloadSizeHistogram } from "~/server/metrics";
import { type BatchEvaluationRepository } from "./repositories/batch-evaluation.repository";

const logger = createLogger("langwatch:evaluations:batch-service");

export interface BatchEvaluationServiceOptions {
  projectId: string;
  params: ESBatchEvaluationRESTParams;
}

export interface BatchEvaluationResult {
  success: boolean;
  error?: string;
}

export class BatchEvaluationService {
  constructor(
    private readonly batchEvaluationRepository: BatchEvaluationRepository
  ) {}

  /**
   * Log batch evaluation results
   */
  async logResults(options: BatchEvaluationServiceOptions): Promise<BatchEvaluationResult> {
    const { projectId, params } = options;

    logger.info({ projectId }, "Logging batch evaluation results");

    // Track payload size
    getPayloadSizeHistogram("log_results").observe(
      JSON.stringify(params).length
    );

    // Validate input parameters
    let validatedParams: ESBatchEvaluationRESTParams;
    try {
      validatedParams = eSBatchEvaluationRESTParamsSchema.parse(params);
    } catch (error) {
      logger.error({ error, params, projectId }, 'Invalid log_results data received');
      Sentry.captureException(error, { extra: { projectId } });
      const validationError = fromZodError(error as ZodError);
      throw new Error(validationError.message);
    }

    // Validate required fields
    if (!validatedParams.experiment_id && !validatedParams.experiment_slug) {
      throw new Error("Either experiment_id or experiment_slug is required");
    }

    // Handle timestamp conversion
    if (
      validatedParams.timestamps?.created_at &&
      typeof validatedParams.timestamps.created_at === 'number' &&
      validatedParams.timestamps.created_at.toString().length === 10
    ) {
      validatedParams.timestamps.created_at = validatedParams.timestamps.created_at * 1000;
    }

    // Find or create experiment
    const experiment = await this.findOrCreateExperiment(projectId, validatedParams);

    // Prepare batch evaluation data
    const batchEvaluation = this.prepareBatchEvaluation(validatedParams, experiment.id, projectId);

    // Store in Elasticsearch
    await this.storeBatchEvaluation(batchEvaluation);

    logger.info({ projectId, experimentId: experiment.id }, "Batch evaluation results logged successfully");

    return { success: true };
  }

  private generateExperimentSlug(experimentId?: string, experimentSlug?: string | null): string {
    return experimentSlug ?? `experiment_${experimentId}`;
  }

  private async findOrCreateExperiment(projectId: string, params: ESBatchEvaluationRESTParams) {
    const experimentSlug = this.generateExperimentSlug(params.experiment_id, params.experiment_slug);
    
    return await this.batchEvaluationRepository.findOrCreateExperiment({
      projectId,
      experiment_slug: experimentSlug,
      experiment_type: ExperimentType.BATCH_EVALUATION,
      experiment_name: params.name ?? experimentSlug,
      workflowId: params.workflow_id ?? undefined,
    });
  }

  private prepareBatchEvaluation(params: ESBatchEvaluationRESTParams, experimentId: string, projectId: string): ESBatchEvaluation {
    const batchEvaluation: ESBatchEvaluation = {
      project_id: projectId,
      experiment_id: experimentId,
      run_id: params.run_id,
      workflow_version_id: params.workflow_id ?? null,
      progress: null,
      total: null,
      dataset: [],
      evaluations: [],
      timestamps: {
        created_at: params.timestamps?.created_at ?? Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
        finished_at: params.timestamps?.finished_at ?? null,
        stopped_at: params.timestamps?.stopped_at ?? null,
      },
    };

    return batchEvaluation;
  }

  private async storeBatchEvaluation(batchEvaluation: ESBatchEvaluation) {
    await this.batchEvaluationRepository.storeBatchEvaluation(batchEvaluation);
  }
}
