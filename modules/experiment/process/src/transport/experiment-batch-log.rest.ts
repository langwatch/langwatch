/**
 * The SDK's batch result log, at the bare `/api/evaluations/batch/log_results`
 * address a released SDK has always called, plus its `/api/v1` twin.
 * @see specs/monitors/guardrails-api-compatibility.feature
 */
import { defineRestRouter, MANAGEMENT_API_VERSION, resolver } from "@langwatch/api/rest";
import {
  DATASET_CEILING_LIMITS,
  DATASET_DEFAULT_LIMITS,
  formatDatasetByteLimit,
} from "@langwatch/dataset-contract";
import {
  EvaluationLogResultsTooLargeError,
  acknowledgementSchema,
  evaluateErrorSchema,
  legacySentenceErrorSchema,
} from "@langwatch/evaluation-contract";
import {
  ExperimentApi,
  eSBatchEvaluationRESTParamsSchema,
  type ESBatchEvaluationRESTParams,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, ZodError as ZodErrorClass } from "zod";
import { fromZodError } from "zod-validation-error";

const logger = createLogger("langwatch:experiment-batch-log");

/**
 * The largest batch any organization can be raised to. The route has no
 * project in reach when the body is read, so it declares this ceiling and the
 * handler then holds the body to the organization's own limit.
 */
const BATCH_LOG_MAX_BYTES = DATASET_CEILING_LIMITS.rowBytes;

/** The door writes its own response: the bodies are the ones released SDKs already parse. */
const PRODUCES_JSON = "application/json";

/** The refusal a batch log past the ceiling earns, by the code the handler's own check uses. */
const batchLogTooLarge = (): Error =>
  new EvaluationLogResultsTooLargeError({ maxBytes: BATCH_LOG_MAX_BYTES });

const LEGACY_PROTOCOL_REASON =
  "Released SDKs parse these doors' own statuses and bodies, refusals included";

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
 * NOTE: the route asks for `evaluations:manage` on an append action, so a key
 * holding only `evaluations:create` is refused. Declaring it makes that VISIBLE.
 */
export const experimentBatchLogRest = defineRestRouter(ExperimentApi)
  .withNamespace("evaluations")
  .withVersion(MANAGEMENT_API_VERSION)
  // `/api` with no version namespace: the path a released SDK already calls.
  .withAddressing("literal", { v1Twin: true })

  .post("/api/evaluations/batch/log_results", "postApiEvaluationsBatchLogResults")
  .servesWhileUpgrading()
  .withInput(z.looseObject({}), { mediaType: PRODUCES_JSON, mismatch: "malformed_request" })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: BATCH_LOG_MAX_BYTES, onExceeded: batchLogTooLarge })
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: LEGACY_PROTOCOL_REASON,
  })
  .withDocs({
    summary: "Report batch evaluation results",
    requestBody: { schema: eSBatchEvaluationRESTParamsSchema },
    description:
      "Report the rows of a batch evaluation against an experiment, so its scores and progress show up in the app. This is the second half of an SDK batch evaluation: create the experiment with `POST /api/experiment/init`, then post rows here as they finish. Identify the experiment by either `experiment_id` or `experiment_slug`. " +
      `Bodies up to ${formatDatasetByteLimit(DATASET_DEFAULT_LIMITS.rowBytes)} are accepted, sized for one dataset row with ten 20 MB images inline. ` +
      "A larger body is refused with `evaluation_log_results_too_large`.",
    tags: ["Evaluations"],
    responses: {
      200: {
        description: "The rows were recorded",
        content: { [PRODUCES_JSON]: { schema: resolver(acknowledgementSchema) } },
      },
      400: {
        description:
          "The request was not sent as application/json, failed validation, named neither experiment_id nor experiment_slug, or carried timestamps in seconds rather than milliseconds",
        content: { [PRODUCES_JSON]: { schema: resolver(legacySentenceErrorSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { [PRODUCES_JSON]: { schema: resolver(evaluateErrorSchema) } },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: { [PRODUCES_JSON]: { schema: resolver(evaluateErrorSchema) } },
      },
      413: {
        description:
          "The body is larger than the organization accepts in one request; `error.code` is `evaluation_log_results_too_large` and `error.meta.maxBytes` is the limit",
      },
    },
  })
  .handle(async ({ app, input, scope, response }) =>
    response.write(await logBatchResults({ app, body: input, projectId: scope.id })),
  )
  .build();

async function logBatchResults({
  app,
  body,
  projectId,
}: {
  app: ExperimentApi;
  body: Record<string, unknown>;
  projectId: string;
}): Promise<LegacyAnswer> {
  // The framework consumed the wire bytes; the re-serialised body is within whitespace of them.
  const payloadSize = Buffer.byteLength(JSON.stringify(body), "utf8");
  await app.assertBatchLogWithinLimit({ projectId, payloadBytes: payloadSize });
  let params: ESBatchEvaluationRESTParams;

  try {
    params = eSBatchEvaluationRESTParamsSchema.parse(body);
  } catch (error) {
    logger.warn({ error, payloadSize, projectId }, "invalid log_results data received");

    return answer({ error: sentenceFor(error) }, 400);
  }

  if (!params.experiment_id && !params.experiment_slug) {
    logger.warn({ runId: params.run_id }, "log_results missing experiment_id and experiment_slug");

    return answer({ error: "Either experiment_id or experiment_slug is required" }, 400);
  }

  const createdAt = params.timestamps?.created_at;
  const createdInSeconds =
    createdAt !== undefined && createdAt !== null ? createdAt.toString().length === 10 : false;

  if (createdInSeconds) {
    return answer(
      {
        error: "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      },
      400,
    );
  }

  return recordBatch({ app, projectId, params });
}

/** The write, and the three shapes its failure is published as. */
async function recordBatch({
  app,
  projectId,
  params,
}: {
  app: ExperimentApi;
  projectId: string;
  params: ESBatchEvaluationRESTParams;
}): Promise<LegacyAnswer> {
  try {
    await app.logBatchEvaluation({ projectId, params });
  } catch (error) {
    if (error instanceof Error && "issues" in error && Array.isArray(error.issues)) {
      logger.error(
        { error, runId: params.run_id, projectId },
        "failed to validate data for batch evaluation",
      );

      return answer({ error: sentenceFor(error) }, 400);
    }

    if (HandledError.isHandled(error)) {
      logger.warn(
        { code: error.code, meta: error.meta, projectId },
        "handled error processing batch evaluation",
      );

      return answer({ error: error.code, message: error.message }, error.httpStatus);
    }

    logger.error(
      { error, runId: params.run_id, projectId },
      "internal server error processing batch evaluation",
    );

    // Generic on purpose (ADR-045): the detail is on the log line above, and a
    // driver's own message names host, port and database.
    return answer({ error: "Internal server error" }, 500);
  }

  return answer({ message: "ok" }, 200);
}

// ============ Shared helpers ============

/** A refusal's sentence, whichever kind of failure produced it. */
function sentenceFor(error: unknown): string {
  if (error instanceof ZodErrorClass) return fromZodError(error).message;
  if (error instanceof Error) return error.message;

  return String(error);
}
