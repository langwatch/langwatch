/**
 * `POST /api/dspy/log_steps` - the DSPy optimizer's own progress log. Like
 * the create-or-take door beside it, this one answers its own bodies: an SDK
 * optimizer parses `{ message }`/`{ error }`, not a reshaping schema.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import {
  dSPyLogStepsBodySchema,
  dSPyLogStepsResponseSchema,
  type DSPyStepRESTParams,
  ExperimentApi,
} from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { dspyStepOf } from "../rules/experiment-dspy-step.rules.ts";
import { experimentDoorRefusal } from "./experiment-init.rest.ts";

const logger = createLogger("langwatch:experiment:dspy");

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error => new HTTPException(413, { message: "Payload Too Large" });

/** Bodies up to 20MB: a single optimizer batch carries every example it saw. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** Retired: the project door resolves the caller. Kept while the package index re-exports it. */
export const dspyStepsCaller = defineRestMiddleware(
  "dspyStepsCaller",
  z.object({ projectId: z.string() }),
);

/** A JSON answer this door writes itself, in the shape an optimizer parses. */
const LEGACY_WIRE =
  "The DSPy SDK reads this family's own flat bodies: `{ message }` for a body that is not JSON or an accepted batch, and `{ error }` with the validation sentence.";

const answer = ({
  response,
  status,
  body,
}: {
  response: RestProtocolProducer<"application/json">;
  status: 200 | 400 | 500;
  body: object;
}) => response.write({ status, mediaType: "application/json", body: JSON.stringify(body) });

/** Stores each step in order and answers for the batch, stopping at the first failure. */
const storeDspySteps = async ({
  app,
  response,
  projectId,
  steps,
}: {
  app: ExperimentApi;
  response: RestProtocolProducer<"application/json">;
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
      const context = { projectId, stepId: param.index, runId: param.run_id };
      logger.error({ error, ...context }, "failed to process DSPy step");
      if (error instanceof z.ZodError) {
        return answer({ response, status: 400, body: { error: zodErrorMessage(error) } });
      }

      // Generic on purpose (ADR-045): the detail is on the log line above,
      // and a driver's own message names host, port and database.
      return answer({ response, status: 500, body: { error: "Internal server error" } });
    }
  }

  return answer({ response, status: 200, body: { message: "ok" } });
};

export const experimentDspyStepsRest = defineRestRouter(ExperimentApi)
  .withNamespace("dspy")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/log_steps", "postApiDspyLogSteps")
  // Read as characters, parsed here: the door reports the wire size it
  // accepted, and answers its own sentence - built by `zodErrorMessage` from
  // the schema's own failure - on a bad batch.
  .withRawBody("text", { mediaType: "application/json" })
  .withPermission("experiments:manage")
  .withResponse("protocol", {
    produces: "application/json",
    because: LEGACY_WIRE,
    refusal: experimentDoorRefusal,
  })
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: payloadTooLarge })
  .withDocs({
    tags: ["Experiments"],
    summary: "Report DSPy optimizer steps",
    description:
      "Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores show up in the app. Send the steps as an array; the optimizer typically posts each batch as it finishes. Bodies up to 20MB are accepted.",
    requestBody: { schema: dSPyLogStepsBodySchema },
    responses: documentedResponses({ 200: dSPyLogStepsResponseSchema }),
    errors: [
      {
        status: 400,
        description:
          "The body was not valid JSON, failed validation, or carried timestamps in seconds rather than milliseconds",
      },
      { status: 401, description: "Missing or invalid API key" },
      { status: 403, description: "The API key lacks experiments:manage" },
      {
        status: 500,
        description:
          "A step could not be stored. The cause is on our side and is logged with the run and step ids; retrying the batch is safe.",
      },
    ],
  })
  .handle(async ({ app, raw, response, scope }) => {
    const projectId = scope.id;

    // The size comes from the wire characters rather than a re-serialisation
    // of the parsed body: bodies here run to 20MB, and stringifying the parse
    // costs a second full pass over it.
    const payloadSize = Buffer.byteLength(raw, "utf8");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return answer({ response, status: 400, body: { message: "Bad request" } });
    }

    logger.info(
      { payloadSize, payloadSizeMB: (payloadSize / (1024 * 1024)).toFixed(2), projectId },
      "DSPy log_steps request received",
    );

    const parsed = dSPyLogStepsBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.error(
        { error: parsed.error, payloadSize, projectId },
        "invalid log_steps data received",
      );

      return answer({ response, status: 400, body: { error: zodErrorMessage(parsed.error) } });
    }

    for (const param of parsed.data) {
      const createdAt = param.timestamps.created_at;
      if (createdAt && createdAt.toString().length === 10) {
        logger.error(
          { stepId: param.index, runId: param.run_id, projectId },
          "timestamps not in milliseconds for step",
        );

        return answer({
          response,
          status: 400,
          body: {
            error:
              "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
          },
        });
      }
    }

    logger.info({ stepCount: parsed.data.length, projectId }, "Processing DSPy steps");

    return storeDspySteps({ app, response, projectId, steps: parsed.data });
  })

  .build();
