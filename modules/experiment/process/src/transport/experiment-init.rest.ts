/**
 * POST /api/experiment/init: find-or-create slug endpoint. Returns raw bodies
 * (not handled-error envelope) to match SDK wire contract.
 */
import { PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  projectRestFacts,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import { zodErrorMessage } from "@langwatch/config";
import {
  ExperimentApi,
  experimentInitBodySchema,
  experimentInitResponseSchema,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

const logger = createLogger("langwatch:experiment:init");

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

/** Retired: the project door resolves the caller. Kept while the package index re-exports it. */
export const experimentInitCaller = defineRestMiddleware(
  "experimentInitCaller",
  z.object({ projectId: z.string(), projectSlug: z.string() }),
);

/** A JSON answer this door writes itself, in the shape an SDK parses. */
const LEGACY_WIRE =
  "The SDKs read this family's own flat bodies: `{ message }` for a body that is not JSON, `{ error }` with the validation sentence, and the flat plan-limit refusal at 403.";

const answer = ({
  response,
  status,
  body,
}: {
  response: RestProtocolProducer<"application/json">;
  status: 200 | 400 | 403;
  body: object;
}) => response.write({ status, mediaType: "application/json", body: JSON.stringify(body) });

/**
 * The plan refusal, flattened. Matched on the CODE, not the licence layer's
 * own class: that class lives in an enterprise package this one may not
 * reach, and a code comparison is what a crossed serialisation boundary asks for.
 */
const limitRefusal = ({
  response,
  error,
}: {
  response: RestProtocolProducer<"application/json">;
  error: HandledError;
}) =>
  answer({
    response,
    status: 403,
    body: {
      error: error.code,
      message: error.message,
      limitType: error.meta.limitType,
      current: error.meta.current,
      max: error.meta.max,
    },
  });

export const experimentInitRest = defineRestRouter(ExperimentApi)
  .withNamespace("experiment")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/init", "postApiExperimentInit")
  // Read as characters and parsed here: this handler answers its own sentence
  // on a bad body - built by `zodErrorMessage` from the schema's own failure -
  // which a validated input cannot hand back.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withPermission("experiments:manage")
  .withResponse("protocol", {
    produces: "application/json",
    because: LEGACY_WIRE,
  })
  .withDocs({
    tags: ["Experiments"],
    summary: "Create an experiment",
    description:
      "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you. The body carries `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and `workflowId` ties it to an Optimization Studio workflow.",
    requestBody: { schema: experimentInitBodySchema },
    responses: documentedResponses({ 200: experimentInitResponseSchema }),
    errors: [
      {
        status: 400,
        description:
          "The body was not valid JSON, or neither experiment_slug nor experiment_id was supplied",
      },
      { status: 401, description: "Missing or invalid API key" },
      {
        status: 403,
        description:
          "The API key lacks experiments:manage, or the plan's experiment limit is already reached",
      },
    ],
  })
  .withMiddleware(projectRestFacts)
  .handle(async ({ app, raw, response, scope }, facts) => {
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return answer({ response, status: 400, body: { message: "Bad request" } });
    }

    const parsed = experimentInitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.error({ error: parsed.error, projectId: scope.id }, "invalid init data received");

      return answer({ response, status: 400, body: { error: zodErrorMessage(parsed.error) } });
    }
    const params = parsed.data;

    try {
      // Both identifiers are forwarded. The route this replaces sent only the
      // slug, so an id-only request passed validation and then raised
      // "Either experiment_id or experiment_slug is required" as a 500.
      const experiment = await app.findOrCreateForRun({
        projectId: scope.id,
        experimentId: params.experiment_id,
        experimentSlug: params.experiment_slug,
        experimentType: params.experiment_type,
        experimentName: params.experiment_name,
        workflowId: params.workflowId,
      });

      return answer({
        response,
        status: 200,
        body: {
          path: `/${facts.projectSlug}/experiments/${experiment.slug}`,
          slug: experiment.slug,
        },
      });
    } catch (error) {
      if (error instanceof HandledError && error.code === "resource_limit_exceeded") {
        return limitRefusal({ response, error });
      }
      throw error;
    }
  })

  .build();
