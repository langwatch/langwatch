import { createLogger } from "~/utils/logger";
import { type ExperimentType, type Experiment } from "@prisma/client";
import type { ESBatchEvaluation } from "~/server/experiments/types";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  esClient,
} from "~/server/elasticsearch";
import { type ExperimentRepository } from "./experiment.repository";

const logger = createLogger("langwatch:evaluations:batch-repository");

export interface BatchEvaluationRepository {
  findOrCreateExperiment(options: {
    projectId: string;
    experiment_id?: string | null;
    experiment_slug?: string | null;
    experiment_type: ExperimentType;
    experiment_name?: string;
    workflowId?: string;
  }): Promise<Experiment>;
  storeBatchEvaluation(batchEvaluation: ESBatchEvaluation): Promise<void>;
}

export class ElasticsearchBatchEvaluationRepository implements BatchEvaluationRepository {
  constructor(private readonly experimentRepository: ExperimentRepository) {}

  async findOrCreateExperiment(options: {
    projectId: string;
    experiment_slug?: string | null;
    experiment_type: ExperimentType;
    experiment_name?: string;
    workflowId?: string;
  }) {
    try {
      return await this.experimentRepository.findOrCreateExperiment(options);
    } catch (error) {
      logger.error({ error, projectId: options.projectId }, "Failed to find or create experiment");
      throw error;
    }
  }

  async storeBatchEvaluation(batchEvaluation: ESBatchEvaluation): Promise<void> {
    try {
      const id = batchEvaluationId({
        projectId: batchEvaluation.project_id,
        experimentId: batchEvaluation.experiment_id,
        runId: batchEvaluation.run_id,
      });
      const client = await esClient({ projectId: batchEvaluation.project_id });
      await client.index({
        index: BATCH_EVALUATION_INDEX.alias,
        id: id,
        body: {
          ...batchEvaluation,
          timestamps: {
            created_at: new Date(batchEvaluation.timestamps.created_at).toISOString(),
            inserted_at: new Date(batchEvaluation.timestamps.inserted_at).toISOString(),
            updated_at: new Date(batchEvaluation.timestamps.updated_at).toISOString(),
            ...(batchEvaluation.timestamps.finished_at && {
              finished_at: new Date(batchEvaluation.timestamps.finished_at).toISOString(),
            }),
            ...(batchEvaluation.timestamps.stopped_at && {
              stopped_at: new Date(batchEvaluation.timestamps.stopped_at).toISOString(),
            }),
          },
        },
      });
    } catch (error) {
      logger.error({ error, runId: batchEvaluation.run_id }, "Failed to store batch evaluation in Elasticsearch");
      throw new Error(`Failed to store batch evaluation results: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
