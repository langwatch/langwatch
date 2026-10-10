/**
 * The SDK's dataset evaluation, at the bare `/api/dataset/evaluate` address a
 * released SDK has always called, plus its `/api/v1` twin.
 * @see modules/experiment/specs/experiment-dataset-evaluation.feature
 */
import { defineRestRouter, MANAGEMENT_API_VERSION, resolver } from "@langwatch/api/rest";
import {
  batchEvaluationInputSchema,
  evaluateErrorSchema,
  evaluateResponseSchema,
  legacySentenceErrorSchema,
  type BatchEvaluationRESTParams,
} from "@langwatch/evaluation-contract";
import { ExperimentApi, type DatasetEvaluationOutcome } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { fromZodError, isZodErrorLike } from "zod-validation-error";

const logger = createLogger("langwatch:experiment-dataset-evaluation");

const EVALUATE_MAX_BYTES = 30 * 1024 * 1024;

/** The door writes its own response: the bodies are the ones released SDKs already parse. */
const PRODUCES_JSON = "application/json";

const LEGACY_PROTOCOL_REASON =
  "Released SDKs parse these doors' own statuses and bodies, refusals included";

/** The dataset evaluation door kept its path in dataset's namespace (§8, R10). */
const DATASET_NAMESPACE = {
  owner: "dataset",
  reason: "released SDKs call the dataset evaluation door at its original path",
  deprecate: "move under a namespace experiment owns in the next API version",
} as const;

/** One protocol answer, in the shape `c.json(body, status)` used to write. */
type LegacyAnswer = Readonly<{
  status: ContentfulStatusCode;
  mediaType: typeof PRODUCES_JSON;
  body: string;
}>;

function answer(body: unknown, status: number): LegacyAnswer {
  return {
    status: status as ContentfulStatusCode,
    mediaType: PRODUCES_JSON,
    body: JSON.stringify(body),
  };
}

/**
 * NOTE: the route asks for `evaluations:manage` on a create action, so a key
 * holding only `evaluations:create` is refused. Declaring it makes that VISIBLE.
 */
export const experimentDatasetEvaluationRest = defineRestRouter(ExperimentApi)
  .withNamespace("dataset-evaluation")
  .withVersion(MANAGEMENT_API_VERSION)
  // `/api` with no version namespace: the path a released SDK already calls.
  .withAddressing("literal", { v1Twin: true })

  .post("/api/dataset/evaluate", "postApiDatasetEvaluate")
  .withSharedPath(DATASET_NAMESPACE)
  .withInput(z.looseObject({}), { mediaType: PRODUCES_JSON, mismatch: "malformed_request" })
  .withPermission("evaluations:manage")
  .withoutAudit("run, not a change")
  .withBodyLimit({ maxBytes: EVALUATE_MAX_BYTES })
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: LEGACY_PROTOCOL_REASON,
  })
  .withDocs({
    summary: "Evaluate a dataset",
    requestBody: { schema: batchEvaluationInputSchema },
    description:
      "Run one evaluator across a saved dataset and record the result against an experiment. Name the dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.",
    tags: ["Datasets"],
    responses: {
      200: {
        description: "The evaluator ran; branch on `status`",
        content: { [PRODUCES_JSON]: { schema: resolver(evaluateResponseSchema) } },
      },
      400: {
        description:
          "The body was not valid JSON, failed validation, or named an evaluator that does not exist",
        content: { [PRODUCES_JSON]: { schema: resolver(legacySentenceErrorSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { [PRODUCES_JSON]: { schema: resolver(legacySentenceErrorSchema) } },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: { [PRODUCES_JSON]: { schema: resolver(evaluateErrorSchema) } },
      },
      404: {
        description: "No dataset with that slug",
        content: { [PRODUCES_JSON]: { schema: resolver(evaluateErrorSchema) } },
      },
      413: {
        description:
          "The body is larger than 30MB; refused before it is read with the `payload_too_large` HandledError",
      },
    },
  })
  .handle(async ({ app, input, scope, response }) =>
    response.write(await evaluateDataset({ app, body: input, projectId: scope.id })),
  )
  .build();

async function evaluateDataset({
  app,
  body,
  projectId,
}: {
  app: ExperimentApi;
  body: Record<string, unknown>;
  projectId: string;
}): Promise<LegacyAnswer> {
  let params: BatchEvaluationRESTParams;

  try {
    params = batchEvaluationInputSchema.parse(body);
  } catch (error) {
    logger.error({ error, projectId }, "invalid evaluation params received");

    return answer({ error: sentenceFor(error) }, 400);
  }

  const outcome = await app.evaluateDataset({
    projectId,
    evaluation: params.evaluation,
    datasetSlug: params.datasetSlug,
    experimentSlug: params.experimentSlug ?? params.batchId,
    data: params.data ?? {},
  });

  return answerFor(outcome);
}

/** Each outcome in the status and body main wrote for it. */
function answerFor(outcome: DatasetEvaluationOutcome): LegacyAnswer {
  switch (outcome.outcome) {
    case "evaluated":
      return answer(outcome.result, 200);
    case "evaluator_not_found":
      return answer({ error: `Evaluator not found: ${outcome.checkType}` }, 400);
    case "missing_field":
      return answer(
        {
          error: `Missing required field for ${outcome.checkType}`,
          requiredFields: outcome.requiredFields,
        },
        400,
      );
    case "invalid_data":
      return answer({ error: outcome.sentence }, 400);
    case "dataset_not_found":
      return answer({ error: "Dataset not found" }, 404);
  }
}

/** A refusal's sentence, whichever kind of failure produced it. */
function sentenceFor(error: unknown): string {
  if (isZodErrorLike(error)) return fromZodError(error).message;
  if (error instanceof Error) return error.message;

  return String(error);
}
