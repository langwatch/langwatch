import { ExperimentType, type Project } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getApp } from "~/server/app-layer/app";
import { DomainError } from "~/server/app-layer/domain-error";
import { captureException } from "~/utils/posthogErrorCapture";
import { prisma } from "../../../../server/db";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  esClient,
} from "../../../../server/elasticsearch";
import { mapEsTargetsToTargets } from "../../../../server/evaluations-v3/services/mappers";
import type {
  ESBatchEvaluation,
  ESBatchEvaluationRESTParams,
  ESBatchEvaluationTarget,
  ESBatchEvaluationTargetType,
} from "../../../../server/experiments/types";
import {
  eSBatchEvaluationRESTParamsSchema,
  eSBatchEvaluationSchema,
  eSBatchEvaluationTargetTypeSchema,
} from "../../../../server/experiments/types.generated";
import { getPayloadSizeHistogram } from "../../../../server/metrics";
import { createLogger } from "../../../../utils/logger/server";
import { safeTruncate } from "../../../../utils/truncate";
import { findOrCreateExperiment } from "../../experiment/init";

/** Valid target types for validation */
const VALID_TARGET_TYPES: ESBatchEvaluationTargetType[] = [
  "prompt",
  "agent",
  "custom",
];

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
  res: NextApiResponse,
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
    logger.warn(
      { contentType: req.headers["content-type"], bodyType: typeof req.body },
      "log_results request body is not json",
    );
    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  getPayloadSizeHistogram("log_results").observe(
    JSON.stringify(req.body).length,
  );

  // TODO: check for plan limits here?

  let params: ESBatchEvaluationRESTParams;
  try {
    params = eSBatchEvaluationRESTParamsSchema.parse(req.body);
  } catch (error) {
    logger.error(
      { error, body: req.body, projectId: project.id },
      "invalid log_results data received",
    );
    // TODO: should it be a warning instead of exception? here and all over our APIs
    captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  if (!params.experiment_id && !params.experiment_slug) {
    logger.warn(
      { runId: params.run_id },
      "log_results missing experiment_id and experiment_slug",
    );
    return res.status(400).json({
      error: "Either experiment_id or experiment_slug is required",
    });
  }

  if (
    params.timestamps?.created_at &&
    params.timestamps.created_at.toString().length === 10
  ) {
    logger.error(
      {
        runId: params.run_id,
        experimentSlug: params.experiment_slug,
        experimentId: params.experiment_id,
      },
      "timestamps not in milliseconds for batch evaluation run",
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
        { error, body: params, projectId: project.id },
        "failed to validate data for batch evaluation",
      );
      captureException(error, {
        extra: { projectId: project.id, param: params },
      });

      const validationError = fromZodError(error);
      return res.status(400).json({ error: validationError.message });
    } else if (DomainError.is(error)) {
      logger.warn(
        { kind: error.kind, meta: error.meta, projectId: project.id },
        "domain error processing batch evaluation",
      );
      return res
        .status(error.httpStatus)
        .json({ error: error.kind, message: error.message });
    } else {
      logger.error(
        { error, body: params, projectId: project.id },
        "internal server error processing batch evaluation",
      );
      captureException(error, {
        extra: { projectId: project.id, param: params },
      });

      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(200).json({ message: "ok" });
}

/**
 * Process targets from the request, handling type extraction from metadata.
 * If metadata contains a "type" field with a valid value, use it as the target type
 * and remove it from metadata.
 */
const processTargets = (
  targets: ESBatchEvaluationRESTParams["targets"],
): ESBatchEvaluationTarget[] | null => {
  if (!targets || targets.length === 0) {
    return null;
  }

  return targets.map((target) => {
    let targetType: ESBatchEvaluationTargetType = target.type ?? "custom";
    let metadata = target.metadata;

    // If metadata contains a "type" field, validate and use it
    if (metadata && "type" in metadata) {
      const typeFromMetadata = metadata.type;
      if (typeof typeFromMetadata === "string") {
        const parseResult =
          eSBatchEvaluationTargetTypeSchema.safeParse(typeFromMetadata);
        if (parseResult.success) {
          targetType = parseResult.data;
          // Remove "type" from metadata since it's now the target type
          const { type: _, ...restMetadata } = metadata;
          metadata = Object.keys(restMetadata).length > 0 ? restMetadata : null;
        } else {
          throw new Error(
            `Invalid target type '${typeFromMetadata}'. Must be one of: ${VALID_TARGET_TYPES.join(", ")}`,
          );
        }
      }
    }

    return {
      id: target.id,
      name: target.name,
      type: targetType,
      prompt_id: target.prompt_id,
      prompt_version: target.prompt_version,
      agent_id: target.agent_id,
      model: target.model,
      metadata: metadata ?? null,
    };
  });
};

const processBatchEvaluation = async (
  project: Project,
  param: ESBatchEvaluationRESTParams,
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

  // Process targets with type extraction from metadata
  const processedTargets = processTargets(param.targets);

  const batchEvaluation: ESBatchEvaluation = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    targets: processedTargets,
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
          // Check evaluator, index, AND target_id for uniqueness
          // target_id can be null for single-target evaluations
          def newTargetId = newEvaluation.target_id;
          def existingTargetId = e.target_id;
          boolean targetMatch = (newTargetId == null && existingTargetId == null) ||
                                (newTargetId != null && newTargetId.equals(existingTargetId));
          if (e.evaluator == newEvaluation.evaluator && e.index == newEvaluation.index && targetMatch) {
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
          // Check index AND target_id for uniqueness (like evaluations)
          // target_id can be null for single-target evaluations
          def newTargetId = newDataset.target_id;
          def existingTargetId = d.target_id;
          boolean targetMatch = (newTargetId == null && existingTargetId == null) ||
                                (newTargetId != null && newTargetId.equals(existingTargetId));
          if (d.index == newDataset.index && targetMatch) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          ctx._source.dataset.add(newDataset);
        }
      }

      // Merge targets (by id)
      if (params.targets != null && params.targets.size() > 0) {
        if (ctx._source.targets == null) {
          ctx._source.targets = [];
        }
        for (newTarget in params.targets) {
          boolean exists = false;
          for (t in ctx._source.targets) {
            if (t.id == newTarget.id) {
              exists = true;
              break;
            }
          }
          if (!exists) {
            ctx._source.targets.add(newTarget);
          }
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
      targets: batchEvaluation.targets ?? [],
      updated_at: new Date().getTime(),
      finished_at: batchEvaluation.timestamps.finished_at,
      stopped_at: batchEvaluation.timestamps.stopped_at,
      progress: batchEvaluation.progress,
      total: batchEvaluation.total,
    },
  };

  // When featureEventSourcingEvaluationIngestion is ON, the experimentRunEsSync
  // reactor handles ES writes — skip direct writes to avoid double-writing.
  if (!project.featureEventSourcingEvaluationIngestion) {
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
  }

  // Dual-write to ClickHouse via event sourcing (unconditional)
  await dispatchToClickHouse(project, experiment.id, batchEvaluation);
};

/**
 * Fire event-sourcing commands for ClickHouse dual-write.
 *
 * Critical commands (startExperimentRun, completeExperimentRun) are awaited.
 * Individual result dispatches are best-effort — failures are logged but
 * don't prevent the run from being recorded.
 * Per-evaluation processing pipeline dispatches remain fire-and-forget.
 */
const dispatchToClickHouse = async (
  project: Project,
  experimentId: string,
  batchEvaluation: ESBatchEvaluation,
) => {
  const { run_id: runId } = batchEvaluation;

  try {
    const targets = mapEsTargetsToTargets(batchEvaluation.targets ?? []);

    // Critical: await the start command so the run exists in CH
    await getApp().experimentRuns.startExperimentRun({
      tenantId: project.id,
      runId,
      experimentId,
      total: batchEvaluation.total || batchEvaluation.dataset.length,
      targets,
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.warn(
      { error, runId, projectId: project.id },
      "Failed to dispatch startExperimentRun to CH — aborting CH dual-write for this batch",
    );
    return; // Without start, individual results would be orphaned
  }

  // Dispatch target and evaluator results — best-effort, log failures
  const resultPromises = [
    ...batchEvaluation.dataset.map((entry) =>
      getApp().experimentRuns.recordTargetResult({
        tenantId: project.id,
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
        occurredAt: Date.now(),
      }).catch((err) => {
        logger.warn(
          { err, runId, index: entry.index, targetId: entry.target_id },
          "Failed to dispatch recordTargetResult to CH",
        );
      }),
    ),
    ...batchEvaluation.evaluations.map((evaluation) =>
      getApp().experimentRuns.recordEvaluatorResult({
        tenantId: project.id,
        runId,
        experimentId,
        index: evaluation.index,
        targetId: evaluation.target_id ?? "",
        evaluatorId: evaluation.evaluator,
        evaluatorName: evaluation.name ?? undefined,
        status: evaluation.status,
        score: typeof evaluation.score === 'number' ? evaluation.score : undefined,
        label: evaluation.label ?? undefined,
        passed: evaluation.passed ?? undefined,
        details: evaluation.details ?? undefined,
        cost: evaluation.cost ?? undefined,
        inputs: evaluation.inputs ?? undefined,
        duration: typeof evaluation.duration === 'number' ? evaluation.duration : undefined,
        occurredAt: Date.now(),
      }).catch((err) => {
        logger.warn(
          { err, runId, index: evaluation.index, evaluator: evaluation.evaluator },
          "Failed to dispatch recordEvaluatorResult to CH",
        );
      }),
    ),
  ];
  await Promise.all(resultPromises);

  // Critical: await the completion command
  if (
    batchEvaluation.timestamps.finished_at ||
    batchEvaluation.timestamps.stopped_at
  ) {
    try {
      await getApp().experimentRuns.completeExperimentRun({
        tenantId: project.id,
        runId,
        experimentId,
        finishedAt: batchEvaluation.timestamps.finished_at ?? undefined,
        stoppedAt: batchEvaluation.timestamps.stopped_at ?? undefined,
        occurredAt: Date.now(),
      });
    } catch (error) {
      logger.warn(
        { error, runId, projectId: project.id },
        "Failed to dispatch completeExperimentRun to CH",
      );
    }
  }

  // Per-evaluation processing pipeline dispatches
  if (project.featureEventSourcingEvaluationIngestion) {
    const app = getApp();
    for (const evaluation of batchEvaluation.evaluations) {
      // Use a deterministic ID so repeated API calls (e.g. SDK progress
      // updates) don't create duplicate evaluation aggregates.
      const targetId = evaluation.target_id ?? "";
      const evaluationId = `local_eval_${runId}_${evaluation.evaluator}_${evaluation.index}_${targetId}`;
      try {
        await app.evaluations.startEvaluation({
          tenantId: project.id,
          evaluationId,
          evaluatorId: evaluation.evaluator,
          evaluatorType: evaluation.evaluator,
          evaluatorName: evaluation.name ?? undefined,
          occurredAt: Date.now(),
        });
        await app.evaluations.completeEvaluation({
          tenantId: project.id,
          evaluationId,
          status: evaluation.status,
          score: typeof evaluation.score === 'number' ? evaluation.score : undefined,
          passed: evaluation.passed ?? undefined,
          label: evaluation.label ?? undefined,
          details: evaluation.details ?? undefined,
          occurredAt: Date.now(),
        });
      } catch (err) {
        logger.warn(
          { err, evaluationId, evaluator: evaluation.evaluator },
          "Failed to dispatch evaluation to evaluation processing pipeline",
        );
      }
    }
  }
};
