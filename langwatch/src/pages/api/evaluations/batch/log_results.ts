import { type NextApiRequest, type NextApiResponse } from "next";

import { createLogger } from "../../../../utils/logger.server";
import { prisma } from "../../../../server/db";
import type {
  ESBatchEvaluation,
  ESBatchEvaluationRESTParams,
} from "../../../../server/experiments/types";
import {
  eSBatchEvaluationRESTParamsSchema,
  eSBatchEvaluationSchema,
} from "../../../../server/experiments/types.generated";
import { z, type ZodError } from "zod";
import * as Sentry from "@sentry/nextjs";
import { fromZodError } from "zod-validation-error";
import { findOrCreateExperiment } from "../../experiment/init";
import { ExperimentType, type Project } from "@prisma/client";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  esClient,
} from "../../../../server/elasticsearch";
import { getPayloadSizeHistogram } from "../../../../server/metrics";
import { safeTruncate } from "../../../../utils/truncate";

const logger = createLogger("langwatch:evaluations:batch:log_results");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;

  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  }

  if (
    req.headers["content-type"] !== "application/json" ||
    typeof req.body !== "object"
  ) {
    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  getPayloadSizeHistogram("log_results").observe(
    JSON.stringify(req.body).length
  );

  // TODO: check for plan limits here?

  let params: ESBatchEvaluationRESTParams;
  try {
    params = eSBatchEvaluationRESTParamsSchema.parse(req.body);
  } catch (error) {
    logger.error(
      "Invalid log_results data received",
      { error, body: req.body, projectId: project.id },
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  if (!params.experiment_id && !params.experiment_slug) {
    return res.status(400).json({
      error: "Either experiment_id or experiment_slug is required",
    });
  }

  if (
    params.timestamps?.created_at &&
    params.timestamps.created_at.toString().length === 10
  ) {
    logger.error(
      "Timestamps not in milliseconds for batch evaluation run",
      {
        runId: params.run_id,
        experimentSlug: params.experiment_slug,
        experimentId: params.experiment_id,
      },
    );
    return res.status(400).json({
      error:
        "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
    });
  }

  try {
    await processBatchEvaluation(project, params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error(
        "Failed to validate data for batch evaluation",
        { error, body: params, projectId: project.id },
      );
      Sentry.captureException(error, {
        extra: { projectId: project.id, param: params },
      });

      const validationError = fromZodError(error);
      return res.status(400).json({ error: validationError.message });
    } else {
      logger.error(
        "Internal server error processing batch evaluation",
        { error, body: params, projectId: project.id },
      );
      Sentry.captureException(error, {
        extra: { projectId: project.id, param: params },
      });

      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(200).json({ message: "ok" });
}

const processBatchEvaluation = async (
  project: Project,
  param: ESBatchEvaluationRESTParams
) => {
  const { run_id, experiment_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment({
    project,
    experiment_id,
    experiment_slug,
    experiment_type: ExperimentType.BATCH_EVALUATION_V2,
    experiment_name: param.name ?? undefined,
    workflowId: param.workflow_id ?? undefined,
  });

  const id = batchEvaluationId({
    projectId: project.id,
    experimentId: experiment.id,
    runId: run_id,
  });

  const batchEvaluation: ESBatchEvaluation = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    dataset:
      param.dataset?.map((entry) => ({
        ...entry,
        ...(entry.entry ? { entry: safeTruncate(entry.entry, 32 * 1024) } : {}),
        ...(entry.predicted
          ? { predicted: safeTruncate(entry.predicted, 32 * 1024) }
          : {}),
      })) ?? [],
    evaluations:
      param.evaluations?.map((evaluation) => ({
        ...evaluation,
        ...(evaluation.inputs
          ? { inputs: safeTruncate(evaluation.inputs, 32 * 1024) }
          : {}),
        ...(evaluation.details
          ? { details: safeTruncate(evaluation.details, 32 * 1024) }
          : {}),
      })) ?? [],
    timestamps: {
      ...param.timestamps,
      created_at: param.timestamps?.created_at ?? new Date().getTime(),
      inserted_at: new Date().getTime(),
      updated_at: new Date().getTime(),
    },
  };

  // To guarantee no extra keys
  const validatedBatchEvaluation =
    eSBatchEvaluationSchema.parse(batchEvaluation);

  const script = {
    source: `
      if (ctx._source.evaluations == null) {
        ctx._source.evaluations = [];
      }
      for (newEvaluation in params.evaluations) {
        boolean exists = false;
        for (e in ctx._source.evaluations) {
          if (e.evaluator == newEvaluation.evaluator && e.index == newEvaluation.index) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          ctx._source.evaluations.add(newEvaluation);
        }
      }

      if (ctx._source.dataset == null) {
        ctx._source.dataset = [];
      }
      for (newDataset in params.dataset) {
        boolean exists = false;
        for (d in ctx._source.dataset) {
          if (d.index == newDataset.index) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          ctx._source.dataset.add(newDataset);
        }
      }

      ctx._source.timestamps.updated_at = params.updated_at;
      if (params.finished_at != null) {
        ctx._source.timestamps.finished_at = params.finished_at;
      }
      if (params.stopped_at != null) {
        ctx._source.timestamps.stopped_at = params.stopped_at;
      }
      if (params.progress != null) {
        ctx._source.progress = params.progress;
      }
      if (params.total != null) {
        ctx._source.total = params.total;
      }
    `,
    params: {
      evaluations: batchEvaluation.evaluations,
      dataset: batchEvaluation.dataset,
      updated_at: new Date().getTime(),
      finished_at: batchEvaluation.timestamps.finished_at,
      stopped_at: batchEvaluation.timestamps.stopped_at,
      progress: batchEvaluation.progress,
      total: batchEvaluation.total,
    },
  };

  const client = await esClient({ projectId: project.id });
  await client.update({
    index: BATCH_EVALUATION_INDEX.alias,
    id,
    body: {
      script,
      upsert: validatedBatchEvaluation,
    },
    retry_on_conflict: 5,
  });
};
