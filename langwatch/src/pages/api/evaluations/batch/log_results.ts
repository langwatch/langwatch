import { type NextApiRequest, type NextApiResponse } from "next";

import { getDebugger } from "../../../../utils/logger";
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

export const debug = getDebugger("langwatch:evaluations:batch:log_results");

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

  // TODO: check for plan limits here?

  let params: ESBatchEvaluationRESTParams;
  try {
    params = eSBatchEvaluationRESTParamsSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid log_results data received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  if (
    params.timestamps.created_at &&
    params.timestamps.created_at.toString().length === 10
  ) {
    debug(
      "Timestamps not in milliseconds for batch evaluation run",
      params.run_id,
      "on experiment",
      params.experiment_slug
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
      debug(
        "Failed to validate data for batch evaluation",
        error,
        JSON.stringify(params, null, "  ")
      );
      Sentry.captureException(error, {
        extra: { projectId: project.id, param: params },
      });

      const validationError = fromZodError(error);
      return res.status(400).json({ error: validationError.message });
    } else {
      debug(
        "Internal server error processing batch evaluation",
        error,
        JSON.stringify(params, null, "  ")
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
  const { run_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment(
    project,
    experiment_slug,
    ExperimentType.BATCH_EVALUATION_V2
  );

  const id = batchEvaluationId({
    projectId: project.id,
    experimentId: experiment.id,
    runId: run_id,
  });

  const batchEvaluation: ESBatchEvaluation = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    timestamps: {
      created_at: param.timestamps.created_at,
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
    `,
    params: {
      evaluations: batchEvaluation.evaluations,
      dataset: batchEvaluation.dataset,
      updated_at: new Date().getTime(),
    },
  };

  await esClient.update({
    index: BATCH_EVALUATION_INDEX.alias,
    id,
    body: {
      script,
      upsert: validatedBatchEvaluation,
    },
    retry_on_conflict: 5,
  });
};
