/** `POST /api/dspy/log_steps`: the DSPy optimizer's progress log; refusals are handled errors. */
import { PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import {
  dSPyLogStepsBodySchema,
  dSPyLogStepsResponseSchema,
  type DSPyStepRESTParams,
  ExperimentApi,
} from "@langwatch/experiment-contract";
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { dspyStepOf } from "../rules/experiment-dspy-step.rules.ts";

const logger = createLogger("langwatch:experiment:dspy");

/** Bodies up to 20MB: a single optimizer batch carries every example it saw. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

const SECONDS_TIMESTAMP_MESSAGE =
  "Timestamps should be in milliseconds not in seconds, please multiply it by 1000";

/** The batch the body carries, or the validation refusal naming why it is not one. */
function stepsOf(raw: string): DSPyStepRESTParams[] {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ValidationError("The body is not valid JSON");
  }

  const parsed = dSPyLogStepsBodySchema.safeParse(body);
  if (!parsed.success) throw new ValidationError(zodErrorMessage(parsed.error));

  const inSeconds = parsed.data.find(
    (param) => param.timestamps.created_at.toString().length === 10,
  );
  if (inSeconds) {
    logger.error(
      { stepId: inSeconds.index, runId: inSeconds.run_id },
      "timestamps not in milliseconds for step",
    );
    throw new ValidationError(SECONDS_TIMESTAMP_MESSAGE, {
      meta: { fieldErrors: { "timestamps.created_at": [SECONDS_TIMESTAMP_MESSAGE] } },
    });
  }

  return parsed.data;
}

/** Retired: the project door resolves the caller. Kept while the package index re-exports it. */
export const dspyStepsCaller = defineRestMiddleware(
  "dspyStepsCaller",
  z.object({ projectId: z.string() }),
);

/** Stores each step in order, stopping at the first failure. */
const storeDspySteps = async ({
  app,
  projectId,
  steps,
}: {
  app: ExperimentApi;
  projectId: string;
  steps: DSPyStepRESTParams[];
}) => {
  const costs = await app.listModelCosts({ projectId });

  for (const param of steps) {
    try {
      const experiment = await app.findOrCreateForRun({
        projectId,
        ...(param.experiment_id ? { experimentId: param.experiment_id } : {}),
        ...(param.experiment_slug ? { experimentSlug: param.experiment_slug } : {}),
        experimentType: "DSPY",
      });

      await app.upsertDspyStep(
        dspyStepOf({
          tenantId: projectId,
          experimentId: experiment.id,
          param,
          costs,
          now: nowInstant().epochMilliseconds,
        }),
      );

      logger.info(
        { stepId: param.index, runId: param.run_id, projectId },
        "Successfully stored DSPy step",
      );
    } catch (error) {
      logger.error(
        { error, projectId, stepId: param.index, runId: param.run_id },
        "failed to process DSPy step",
      );
      throw error;
    }
  }
};

export const experimentDspyStepsRest = defineRestRouter(ExperimentApi)
  .withNamespace("dspy")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/log_steps", "postApiDspyLogSteps")
  // Raw because the body is a bare array, which a validated input cannot carry.
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("experiments:manage")
  .withOutput(dSPyLogStepsResponseSchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withDocs({
    tags: ["Experiments"],
    summary: "Report DSPy optimizer steps",
    description:
      "Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores show up in the app. Send the steps as an array; the optimizer typically posts each batch as it finishes. Bodies up to 20MB are accepted.",
    requestBody: { schema: dSPyLogStepsBodySchema },
    errors: [
      { status: 401, description: "Missing or invalid API key" },
      { status: 403, description: "The API key lacks experiments:manage" },
      { status: 413, description: "The body is larger than 20MB" },
      {
        status: 422,
        description:
          "The body was not valid JSON, failed validation, or carried timestamps in seconds rather than milliseconds",
      },
      {
        status: 500,
        description:
          "A step could not be stored. The cause is on our side and is logged with the run and step ids; retrying the batch is safe.",
      },
    ],
  })
  .handle(async ({ app, raw, scope }) => {
    const projectId = scope.id;
    const input = stepsOf(raw);

    logger.info({ stepCount: input.length, projectId }, "Processing DSPy steps");
    await storeDspySteps({ app, projectId, steps: input });

    return { message: "ok" };
  })

  .build();
