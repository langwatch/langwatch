/**
 * `POST /api/experiment/init` - the first call an SDK run makes. Resolves a
 * caller-chosen slug through the one find-or-create rule the batch log uses,
 * so repeated runs under one slug group together.
 *
 * The door answers its own bodies rather than the handled-error envelope: an
 * SDK parses `{ message }`, `{ error }` and the flat limit shape, and those
 * three are the wire contract. That is why the route declares a raw answer -
 * a declared output schema would reshape every refusal on the way out.
 * Spec: modules/experiment/specs/experiment-service.feature.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestMiddleware, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import { ExperimentApi, experimentInitBodySchema } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { INIT_EXPERIMENT } from "../rules/experiment-openapi.rules.ts";

/**
 * Experiments carry their own permission, decoupled from workflows. The check
 * itself is the process's: its bound credential fact resolves the project and
 * enforces `experiments:manage` before the public route handler runs.
 */
const DOOR_REASON =
  "the process's credential port resolves the project this key may act in and enforces experiments:manage as its ceiling before the handler runs";

const logger = createLogger("langwatch:experiment:init");

/**
 * The project this request resolved to, bound by the process after its own
 * credential port has refused anything that should not reach the handler.
 */
export const experimentInitCaller = defineRestMiddleware(
  "experimentInitCaller",
  z.object({ projectId: z.string(), projectSlug: z.string() }),
);

/** A JSON answer this door writes itself, in the shape an SDK parses. */
const answer = (status: 200 | 400 | 403, body: object) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * The plan refusal, flattened. Matched on the CODE rather than on the licence
 * layer's own class: that class lives in an enterprise package this one may not
 * reach, and a code comparison is what the repo asks for anywhere an error may
 * have crossed a serialisation boundary.
 */
const limitRefusal = (error: HandledError) =>
  answer(403, {
    error: error.code,
    message: error.message,
    limitType: error.meta.limitType,
    current: error.meta.current,
    max: error.meta.max,
  });

export const experimentInitRest = defineRestRouter(ExperimentApi)
  .withNamespace("experiment")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/init", "initExperiment")
  // Read as characters and parsed here: this handler answers its own sentence
  // on a bad body - built by `zodErrorMessage` from the schema's own failure -
  // which a validated input cannot hand back.
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(publicRoute({ reason: DOOR_REASON }))
  .withRawResponse({ produces: "application/json" })
  .withDocs(INIT_EXPERIMENT)
  .withMiddleware(experimentInitCaller)
  .handle(async ({ app, raw }, caller) => {
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return answer(400, { message: "Bad request" });
    }

    const parsed = experimentInitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.error(
        { error: parsed.error, projectId: caller.projectId },
        "invalid init data received",
      );

      return answer(400, { error: zodErrorMessage(parsed.error) });
    }
    const params = parsed.data;

    try {
      // Both identifiers are forwarded. The route this replaces sent only the
      // slug, so an id-only request passed validation and then raised
      // "Either experiment_id or experiment_slug is required" as a 500.
      const experiment = await app.findOrCreateForRun({
        projectId: caller.projectId,
        experimentId: params.experiment_id,
        experimentSlug: params.experiment_slug,
        experimentType: params.experiment_type,
        experimentName: params.experiment_name,
        workflowId: params.workflowId,
      });

      return answer(200, {
        path: `/${caller.projectSlug}/experiments/${experiment.slug}`,
        slug: experiment.slug,
      });
    } catch (error) {
      if (error instanceof HandledError && error.code === "resource_limit_exceeded") {
        return limitRefusal(error);
      }
      throw error;
    }
  })

  .build();
