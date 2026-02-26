/**
 * Elasticsearch implementation of BatchEvaluationRepository.
 */

import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  esClient,
} from "~/server/elasticsearch";
import type { ESBatchEvaluation } from "~/server/experiments/types";
import { eSBatchEvaluationSchema } from "~/server/experiments/types.generated";
import { createLogger } from "~/utils/logger/server";
import { safeTruncate } from "~/utils/truncate";
import type {
  BatchEvaluation,
  BatchEvaluationRepository,
  CreateBatchEvaluationParams,
  MarkCompleteParams,
  UpsertResultsParams,
} from "./batchEvaluation.repository";

const logger = createLogger("evaluations-v3:es-batch-evaluation-repository");

/**
 * Creates an Elasticsearch batch evaluation repository.
 */
export const createElasticsearchBatchEvaluationRepository =
  (): BatchEvaluationRepository => {
    const create = async (
      params: CreateBatchEvaluationParams,
    ): Promise<void> => {
      const {
        projectId,
        experimentId,
        runId,
        workflowVersionId,
        total,
        targets,
      } = params;

      const id = batchEvaluationId({ projectId, experimentId, runId });
      const now = Date.now();

      const batchEvaluation: ESBatchEvaluation = {
        project_id: projectId,
        experiment_id: experimentId,
        run_id: runId,
        workflow_version_id: workflowVersionId,
        progress: 0,
        total,
        targets: targets ?? null,
        dataset: [],
        evaluations: [],
        timestamps: {
          created_at: now,
          inserted_at: now,
          updated_at: now,
        },
      };

      // Validate
      const validated = eSBatchEvaluationSchema.parse(batchEvaluation);

      const client = await esClient({ projectId });
      await client.index({
        index: BATCH_EVALUATION_INDEX.alias,
        id,
        body: validated,
        op_type: "create",
      }).catch((error: any) => {
        if (error?.statusCode === 409 || error?.meta?.statusCode === 409) {
          logger.debug({ runId }, "Batch evaluation already exists, skipping create");
          return;
        }
        throw error;
      });

      logger.debug(
        { runId, total, targetCount: targets?.length },
        "Created batch evaluation",
      );
    };

    const upsertResults = async (
      params: UpsertResultsParams,
    ): Promise<void> => {
      const { projectId, experimentId, runId, dataset, evaluations, progress } =
        params;

      const id = batchEvaluationId({ projectId, experimentId, runId });
      const now = Date.now();

      // Truncate large fields
      const truncatedDataset =
        dataset?.map((entry) => ({
          ...entry,
          entry: safeTruncate(entry.entry, 32 * 1024),
          predicted: entry.predicted
            ? safeTruncate(entry.predicted, 32 * 1024)
            : undefined,
        })) ?? [];

      const truncatedEvaluations =
        evaluations?.map((evaluation) => ({
          ...evaluation,
          inputs: evaluation.inputs
            ? safeTruncate(evaluation.inputs, 32 * 1024)
            : undefined,
          details: evaluation.details
            ? safeTruncate(evaluation.details, 32 * 1024)
            : undefined,
        })) ?? [];

      // Script for merging results with existing document
      // Uses target_id for uniqueness in Evaluations V3
      const script = {
        source: `
        // Merge dataset entries (by index + target_id)
        if (ctx._source.dataset == null) {
          ctx._source.dataset = [];
        }
        for (newDataset in params.dataset) {
          boolean exists = false;
          for (d in ctx._source.dataset) {
            if (d.index == newDataset.index && d.target_id == newDataset.target_id) {
              exists = true;
              break;
            }
          }
          if (!exists) {
            ctx._source.dataset.add(newDataset);
          }
        }

        // Merge evaluations (by index + evaluator + target_id)
        if (ctx._source.evaluations == null) {
          ctx._source.evaluations = [];
        }
        for (newEvaluation in params.evaluations) {
          boolean exists = false;
          for (e in ctx._source.evaluations) {
            if (e.index == newEvaluation.index && e.evaluator == newEvaluation.evaluator && e.target_id == newEvaluation.target_id) {
              exists = true;
              break;
            }
          }
          if (!exists) {
            ctx._source.evaluations.add(newEvaluation);
          }
        }

        // Update timestamps and progress
        ctx._source.timestamps.updated_at = params.updated_at;
        if (params.progress != null) {
          ctx._source.progress = params.progress;
        }
      `,
        params: {
          dataset: truncatedDataset,
          evaluations: truncatedEvaluations,
          updated_at: now,
          progress: progress ?? null,
        },
      };

      const client = await esClient({ projectId });
      await client.update({
        index: BATCH_EVALUATION_INDEX.alias,
        id,
        body: { script },
        retry_on_conflict: 5,
      });

      logger.debug(
        {
          runId,
          datasetCount: truncatedDataset.length,
          evaluationsCount: truncatedEvaluations.length,
          progress,
        },
        "Upserted batch evaluation results",
      );
    };

    const markComplete = async (params: MarkCompleteParams): Promise<void> => {
      const { projectId, experimentId, runId, finishedAt, stoppedAt } = params;

      const id = batchEvaluationId({ projectId, experimentId, runId });
      const now = Date.now();

      const script = {
        source: `
        ctx._source.timestamps.updated_at = params.updated_at;
        if (params.finished_at != null) {
          ctx._source.timestamps.finished_at = params.finished_at;
        }
        if (params.stopped_at != null) {
          ctx._source.timestamps.stopped_at = params.stopped_at;
        }
      `,
        params: {
          updated_at: now,
          finished_at: finishedAt ?? null,
          stopped_at: stoppedAt ?? null,
        },
      };

      const client = await esClient({ projectId });
      await client.update({
        index: BATCH_EVALUATION_INDEX.alias,
        id,
        body: { script },
        retry_on_conflict: 3,
      });

      logger.debug(
        { runId, finishedAt, stoppedAt },
        "Marked batch evaluation complete",
      );
    };

    const getByRunId = async (params: {
      projectId: string;
      experimentId: string;
      runId: string;
    }): Promise<BatchEvaluation | null> => {
      const { projectId, experimentId, runId } = params;
      const id = batchEvaluationId({ projectId, experimentId, runId });

      const client = await esClient({ projectId });
      try {
        const result = await client.get<ESBatchEvaluation>({
          index: BATCH_EVALUATION_INDEX.alias,
          id,
        });
        return result._source ?? null;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.meta?.statusCode === 404) {
          return null;
        }
        throw error;
      }
    };

    const listByExperiment = async (params: {
      projectId: string;
      experimentId: string;
      limit?: number;
      offset?: number;
    }): Promise<BatchEvaluation[]> => {
      const { projectId, experimentId, limit = 50, offset = 0 } = params;

      const client = await esClient({ projectId });
      const result = await client.search<ESBatchEvaluation>({
        index: BATCH_EVALUATION_INDEX.alias,
        body: {
          query: {
            bool: {
              must: [
                { term: { project_id: projectId } },
                { term: { experiment_id: experimentId } },
              ],
            },
          },
          sort: [{ "timestamps.created_at": { order: "desc" } }],
          from: offset,
          size: limit,
        },
      });

      return result.hits.hits
        .map((hit) => hit._source)
        .filter((source): source is ESBatchEvaluation => source !== undefined);
    };

    return {
      create,
      upsertResults,
      markComplete,
      getByRunId,
      listByExperiment,
    };
  };

/**
 * Default singleton instance.
 */
let defaultRepository: BatchEvaluationRepository | null = null;

export const getDefaultBatchEvaluationRepository =
  (): BatchEvaluationRepository => {
    if (!defaultRepository) {
      defaultRepository = createElasticsearchBatchEvaluationRepository();
    }
    return defaultRepository;
  };
