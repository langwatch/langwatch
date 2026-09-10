/**
 * `POST /api/dspy/log_steps` - the DSPy optimizer's own progress log.
 *
 * Like the create-or-take door beside it, this one answers its own bodies: an
 * SDK optimizer parses `{ message }` and `{ error }`, so the route declares a
 * raw answer rather than a schema that would reshape every refusal on the way
 * out. Spec: modules/experiment/specs/experiment-service.feature.
 */
import { deferredScope } from "@langwatch/api/access";
import { defineRestMiddleware, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import { dSPyStepRESTParamsSchema, ExperimentApi } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { LOG_DSPY_STEPS } from "../rules/experiment-openapi.rules.ts";
import { dspyStepOf } from "../rules/experiment-dspy-step.rules.ts";

/**
 * Experiments carry their own permission, decoupled from workflows. The check
 * itself is the process's: its credential port resolves the project this key
 * may act in and enforces `experiments:manage` as the key's ceiling, then binds
 * the project as this door's own fact.
 */
const DOOR_REASON =
  "the process's credential port resolves the project this key may act in and enforces experiments:manage as its ceiling before the handler runs";

const logger = createLogger("langwatch:experiment:dspy");

/** Bodies up to 20MB: a single optimizer batch carries every example it saw. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** The project this request resolved to, bound by the process. */
export const dspyStepsCaller = defineRestMiddleware(
  "dspyStepsCaller",
  z.object({ projectId: z.string() }),
);

/** A JSON answer this door writes itself, in the shape an optimizer parses. */
const answer = (status: 200 | 400 | 500, body: object) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const experimentDspyStepsRest = defineRestRouter(ExperimentApi)
  .withNamespace("dspy")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/log_steps", "logDspySteps")
  // Read as characters, parsed here: the door reports the wire size it
  // accepted, and answers its own sentence - built by `zodErrorMessage` from
  // the schema's own failure - on a bad batch.
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(deferredScope({ reason: DOOR_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES })
  .withDocs(LOG_DSPY_STEPS)
  .withMiddleware(dspyStepsCaller)
  .handle(async ({ app, raw }, caller) => {
    const { projectId } = caller;

    // The size comes from the wire characters rather than a re-serialisation
    // of the parsed body: bodies here run to 20MB, and stringifying the parse
    // costs a second full pass over it.
    const payloadSize = Buffer.byteLength(raw, "utf8");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return answer(400, { message: "Bad request" });
    }

    logger.info(
      { payloadSize, payloadSizeMB: (payloadSize / (1024 * 1024)).toFixed(2), projectId },
      "DSPy log_steps request received",
    );

    const parsed = z.array(dSPyStepRESTParamsSchema).safeParse(body);
    if (!parsed.success) {
      logger.error(
        { error: parsed.error, payloadSize, projectId },
        "invalid log_steps data received",
      );

      return answer(400, { error: zodErrorMessage(parsed.error) });
    }

    for (const param of parsed.data) {
      if (param.timestamps.created_at && param.timestamps.created_at.toString().length === 10) {
        logger.error(
          { stepId: param.index, runId: param.run_id, projectId },
          "timestamps not in milliseconds for step",
        );

        return answer(400, {
          error: "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
        });
      }
    }

    logger.info({ stepCount: parsed.data.length, projectId }, "Processing DSPy steps");

    const costs = await app.listModelCosts({ projectId });

    for (const param of parsed.data) {
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
          return answer(400, { error: zodErrorMessage(error) });
        }

        // Generic on purpose (ADR-045): the detail is on the log line above,
        // and a driver's own message names host, port and database.
        return answer(500, { error: "Internal server error" });
      }
    }

    return answer(200, { message: "ok" });
  })

  .build();
