/**
 * The public evaluation doors an already-released SDK calls, each at the bare
 * `/api/...` address it has always answered at, plus its `/api/v1` twin.
 * @see specs/monitors/guardrails-api-compatibility.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawAnswer,
} from "@langwatch/api/rest";
import { mapZodIssuesToLogContext } from "@langwatch/config";
import {
  EvaluationApi,
  EvaluatorMissingFieldError,
  type EvaluationDispatchData,
  type EvaluationMonitorSummary,
} from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  EvaluatorInvalidConfigError,
  EvaluatorNotFoundError,
  EvaluatorWorkflowNotFoundError,
  evaluatorsSchema,
  getEvaluatorDefaultSettings,
  type CustomEvaluatorDefinition,
  type EvaluationResult,
  type EvaluatorDefinition,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  eSBatchEvaluationRESTParamsSchema,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  resolveDispatchEvaluatorType,
  type ESBatchEvaluationRESTParams,
} from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { getInputsOutputs, type StudioEdge, type StudioNode } from "@langwatch/workflow-contract";
import { HTTPException } from "hono/http-exception";
import { nanoid } from "nanoid";
import { ZodError as ZodErrorClass, z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  getEvaluatorDataForParams,
  stripIncompatiblePairwisePrompt,
  translateLegacyPairwisePayload,
} from "../rules/evaluation-dispatch.rules.ts";
import { buildEvaluatorCatalogue } from "../rules/evaluator-catalogue.rules.ts";
import {
  acknowledgementSchema,
  evaluateErrorSchema,
  evaluateResponseSchema,
  evaluationInputSchema,
  evaluatorCatalogueResponseSchema,
  legacySentenceErrorSchema,
  type EvaluationRESTParams,
  type EvaluationRESTResult,
} from "../rules/evaluations-legacy-schemas.rules.ts";

const logger = createLogger("langwatch:evaluations-legacy");

/**
 * The ksuid prefixes an evaluation and a cost row are minted with. STATED here
 * rather than imported: the resource catalogue that names them is a browser
 * module, and a server package may not value-import one.
 */
const EVALUATION_KSUID_PREFIX = "eval";
const COST_KSUID_PREFIX = "cost";

/**
 * The model an evaluator falls back to when the project's cascade names none.
 * Same reason as the ksuid prefixes: the constants module is a browser one.
 */
const DEFAULT_MODEL = "openai/gpt-5";
const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

const BATCH_LOG_MAX_BYTES = 20 * 1024 * 1024;
const EVALUATE_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Every door here writes its own response: the bodies are the ones released
 * SDKs already parse, and a declared output schema would re-serialise them
 * through zod and drop whatever it does not name.
 */
const PRODUCES_JSON = "application/json";

/**
 * A `POST /api/dataset/evaluate` named an experiment slug this project holds no
 * experiment for.
 */
class EvaluationRestExperimentNotFoundError extends HandledError {
  declare readonly code: "not_found";

  constructor(slug: string) {
    super("not_found", "Experiment not found", {
      httpStatus: 404,
      meta: { experimentSlug: slug },
    });
    this.name = "EvaluationRestExperimentNotFoundError";
  }
}

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** One answer, in the shape `c.json(body, status)` used to write. */
function answer(body: unknown, status: number): RestRawAnswer {
  return {
    status: status as RestRawAnswer["status"],
    headers: { "Content-Type": PRODUCES_JSON },
    body: JSON.stringify(body),
  };
}

/**
 * What goes in the `{evaluator}` slot. Not a closed set, and not enumerable
 * here: two of the three forms name rows in the caller's own project.
 */
const EVALUATOR_PARAM_DESCRIPTION =
  "Which evaluator to run. Either a built-in id (`ragas/faithfulness`), the slug of a monitor configured in this project, or `evaluators/{slug|id}` for a saved evaluator. `GET /api/evaluations/list` returns the built-in ids.";

const evaluatorParamsSchema = z.object({
  evaluator: z.string().describe(EVALUATOR_PARAM_DESCRIPTION),
});

const namespacedEvaluatorParamsSchema = z.object({
  evaluator: z.string().describe("First segment of the evaluator id, such as `ragas`"),
  subpath: z.string().describe("Second segment of the evaluator id, such as `faithfulness`"),
});

/** What every evaluate route documents; the three answer the same shapes. */
const EVALUATE_RESPONSES = {
  200: {
    description:
      "The evaluator ran, declined, or failed. Branch on `status`; in guardrail mode `passed` is set on all three.",
    content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateResponseSchema) } },
  },
  400: {
    description:
      "The body was not valid JSON, failed validation, or omitted a field this evaluator requires",
    content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
  },
  401: {
    description: "Missing or invalid API key",
    content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
  },
  403: {
    description: "The API key lacks evaluations:manage",
    content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
  },
  404: {
    description: "No evaluator answers to that id",
    content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
  },
} as const;

/**
 * The catalogue, built once. Deriving JSON Schema over ~40 settings schemas is
 * not free, and the answer is the same for every caller on every request.
 */
let evaluatorCatalogue: Record<string, unknown> | undefined;

/**
 * NOTE: every credentialed route here asks for `evaluations:manage` on what are
 * append/create actions, so a key holding only `evaluations:create` is refused.
 * Declaring it does not fix that; it makes it VISIBLE.
 */
export const evaluationsLegacyRest = defineRestRouter(EvaluationApi)
  .withNamespace("evaluations-legacy")
  .withVersion(MANAGEMENT_API_VERSION)
  // `/api` with no version namespace: these six paths are the ones a released
  // SDK already calls, and a version guard here would claim every other
  // family's URL under the same prefix.
  .withAddressing("literal", { v1Twin: true })

  .get("/api/evaluations/list", "getApiEvaluationsList")
  .withAccess(
    publicRoute({
      reason: "static evaluator catalogue; the same list for every caller, no project data",
    }),
  )
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "List the built-in evaluators",
    description:
      "List every evaluator this server ships with, along with the `data` fields each one needs and the settings it accepts. The keys of `evaluators` are the ids you put in the evaluate path. The list is the same for every caller and needs no credential.",
    tags: ["Evaluations"],
    responses: {
      200: {
        description: "The evaluator catalogue",
        content: {
          [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluatorCatalogueResponseSchema) },
        },
      },
    },
  })
  .handle(() => {
    evaluatorCatalogue ??= buildEvaluatorCatalogue();

    return answer({ evaluators: evaluatorCatalogue }, 200);
  })

  .post("/api/evaluations/batch/log_results", "postApiEvaluationsBatchLogResults")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: BATCH_LOG_MAX_BYTES, onExceeded: payloadTooLarge })
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "Report batch evaluation results",
    description:
      "Report the rows of a batch evaluation against an experiment, so its scores and progress show up in the app. This is the second half of an SDK batch evaluation: create the experiment with `POST /api/experiment/init`, then post rows here as they finish. Identify the experiment by either `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.",
    tags: ["Evaluations"],
    responses: {
      200: {
        description: "The rows were recorded",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(acknowledgementSchema) } },
      },
      400: {
        description:
          "The request was not sent as application/json, failed validation, named neither experiment_id nor experiment_slug, or carried timestamps in seconds rather than milliseconds",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(legacySentenceErrorSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
      },
    },
  })
  .handle(({ app, raw, request, scope }) =>
    logBatchResults({ app, raw, request, projectId: scope.id }),
  )

  .post("/api/evaluations/:evaluator/evaluate", "postApiEvaluationsByEvaluatorEvaluate")
  .withParams(evaluatorParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: EVALUATE_MAX_BYTES, onExceeded: payloadTooLarge })
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "Run an evaluator",
    description:
      "Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies up to 30MB are accepted.",
    tags: ["Evaluations"],
    responses: EVALUATE_RESPONSES,
  })
  .handle(({ app, raw, input, scope }) =>
    handleEvaluatorCall({
      app,
      raw,
      projectId: scope.id,
      evaluatorSlug: input.evaluator,
      asGuardrail: false,
    }),
  )

  .post(
    "/api/evaluations/:evaluator/:subpath/evaluate",
    "postApiEvaluationsByEvaluatorBySubpathEvaluate",
  )
  .withParams(namespacedEvaluatorParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: EVALUATE_MAX_BYTES, onExceeded: payloadTooLarge })
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "Run a namespaced evaluator",
    description:
      "Run one evaluator whose id has two segments, such as `ragas/faithfulness` or `langevals/valid_format`. Identical to the single-segment form in every other respect; the id is simply split across two path segments.",
    tags: ["Evaluations"],
    responses: EVALUATE_RESPONSES,
  })
  .handle(({ app, raw, input, scope }) =>
    handleEvaluatorCall({
      app,
      raw,
      projectId: scope.id,
      evaluatorSlug: `${input.evaluator}/${input.subpath}`,
      asGuardrail: false,
    }),
  )

  .post("/api/guardrails/:evaluator/evaluate", "postApiGuardrailsByEvaluatorEvaluate")
  .withParams(evaluatorParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: EVALUATE_MAX_BYTES, onExceeded: payloadTooLarge })
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "Run an evaluator as a guardrail",
    description:
      "Run an evaluator inline and gate on one boolean. Same call as the evaluate path with `as_guardrail` set: every outcome carries `passed`, so an evaluator that skips or fails does not block the request it was guarding. Check `passed` and let the request through when it is true.",
    tags: ["Evaluations"],
    responses: EVALUATE_RESPONSES,
  })
  .handle(({ app, raw, input, scope }) =>
    handleEvaluatorCall({
      app,
      raw,
      projectId: scope.id,
      evaluatorSlug: input.evaluator,
      asGuardrail: true,
    }),
  )

  .post("/api/dataset/evaluate", "postApiDatasetEvaluate")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withPermission("evaluations:manage")
  .withBodyLimit({ maxBytes: EVALUATE_MAX_BYTES, onExceeded: payloadTooLarge })
  .withRawResponse({ produces: PRODUCES_JSON })
  .withDocs({
    summary: "Evaluate a dataset",
    description:
      "Run one evaluator across a saved dataset and record the result against an experiment. Name the dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.",
    tags: ["Datasets"],
    responses: {
      200: {
        description: "The evaluator ran; branch on `status`",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateResponseSchema) } },
      },
      400: {
        description:
          "The body was not valid JSON, failed validation, or named an evaluator that does not exist",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(legacySentenceErrorSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(legacySentenceErrorSchema) } },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
      },
      404: {
        description: "No dataset with that slug",
        content: { [PRODUCES_JSON]: { schema: z.toJSONSchema(evaluateErrorSchema) } },
      },
      413: {
        description:
          "The body is larger than 30MB. Refused before it is read, so the response is the plain sentence `Payload Too Large` rather than a JSON error",
        content: { "text/plain": { schema: { type: "string" } } },
      },
    },
  })
  .handle(({ app, raw, scope }) => evaluateDataset({ app, raw, projectId: scope.id }))
  .build();

// ============ The batch result log ============

const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.looseObject({}).optional().nullable(),
  settings: z.looseObject({}).optional().nullable(),
});

type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

async function logBatchResults({
  app,
  raw,
  request,
  projectId,
}: {
  app: EvaluationApi;
  raw: string;
  request: Request;
  projectId: string;
}): Promise<RestRawAnswer> {
  const contentType = request.headers.get("content-type");

  if (!contentType?.includes(PRODUCES_JSON)) {
    logger.warn({ contentType }, "log_results request body is not json");

    return answer({ message: "Invalid body, expecting json" }, 400);
  }

  // Size comes from the wire bytes, not a re-serialisation of the parsed body —
  // these payloads carry full dataset entries and LLM outputs.
  const payloadSize = Buffer.byteLength(raw, "utf8");
  const body = parseJson(raw);

  if (!body) return answer({ message: "Invalid body, expecting json" }, 400);

  let params: ESBatchEvaluationRESTParams;

  try {
    params = eSBatchEvaluationRESTParamsSchema.parse(body);
  } catch (error) {
    logger.error({ error, payloadSize, projectId }, "invalid log_results data received");

    return answer({ error: sentenceFor(error) }, 400);
  }

  if (!params.experiment_id && !params.experiment_slug) {
    logger.warn({ runId: params.run_id }, "log_results missing experiment_id and experiment_slug");

    return answer({ error: "Either experiment_id or experiment_slug is required" }, 400);
  }

  const createdAt = params.timestamps?.created_at;
  const createdInSeconds = createdAt !== undefined && createdAt !== null
    ? createdAt.toString().length === 10
    : false;

  if (createdInSeconds) {
    return answer(
      {
        error:
          "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
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
  app: EvaluationApi;
  projectId: string;
  params: ESBatchEvaluationRESTParams;
}): Promise<RestRawAnswer> {
  try {
    await app.logBatchEvaluation({ projectId, params });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error(
        { error, runId: params.run_id, projectId },
        "failed to validate data for batch evaluation",
      );

      return answer({ error: fromZodError(error).message }, 400);
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

// ============ The dataset evaluation ============

async function evaluateDataset({
  app,
  raw,
  projectId,
}: {
  app: EvaluationApi;
  raw: string;
  projectId: string;
}): Promise<RestRawAnswer> {
  const body = parseJson(raw);

  if (!body) return answer({ message: "Bad request" }, 400);

  let params: BatchEvaluationRESTParams;

  try {
    params = batchEvaluationInputSchema.parse(body);
  } catch (error) {
    logger.error({ error, projectId }, "invalid evaluation params received");

    return answer({ error: sentenceFor(error) }, 400);
  }

  const { datasetSlug } = params;
  const experimentSlug = params.experimentSlug ?? params.batchId ?? nanoid();
  const evaluation = params.evaluation;
  const monitor = await app.findMonitorBySlug({ projectId, slug: evaluation });
  const checkType = monitor?.checkType ?? evaluation;
  const settings = monitor ? monitor.parameters : null;

  const evaluator = await getEvaluatorIncludingCustom(app, projectId, checkType as EvaluatorTypes);

  if (!evaluator) return answer({ error: `Evaluator not found: ${checkType}` }, 400);

  let data: EvaluationDispatchData;

  try {
    data = getEvaluatorDataForParams(checkType, params.data as Record<string, any>);

    if (!evaluator.requiredFields.every((field: string) => field in data.data)) {
      return answer(
        {
          error: `Missing required field for ${checkType}`,
          requiredFields: evaluator.requiredFields,
        },
        400,
      );
    }
  } catch (error) {
    logger.error({ error, body, projectId }, "invalid evaluation data received");

    return answer({ error: sentenceFor(error) }, 400);
  }

  const dataset = await app.findDatasetBySlug({ projectId, slug: datasetSlug });

  if (!dataset) return answer({ error: "Dataset not found" }, 404);

  const result = await runOrReportInternalError(() =>
    app.runEvaluator({
      projectId,
      data,
      evaluatorType: checkType as EvaluatorTypes,
      settings: (settings as Record<string, unknown>) ?? {},
    }),
  );

  const experiment = await app.findExperimentBySlug({ projectId, slug: experimentSlug });

  if (!experiment) throw new EvaluationRestExperimentNotFoundError(experimentSlug);

  if ("cost" in result && result.cost) {
    await app.recordEvaluationCost({
      id: `cost_${nanoid()}`,
      projectId,
      costType: "BATCH_EVALUATION",
      costName: evaluation,
      referenceType: "BATCH",
      referenceId: experiment.id,
      amount: result.cost.amount,
      currency: result.cost.currency,
    });
  }

  const { score, passed, details, cost, status, label } = result as EvaluationResult;

  await app.recordDatasetEvaluationRow({
    id: nanoid(),
    experimentId: experiment.id,
    projectId,
    data: data.data,
    status,
    score: score ?? 0,
    passed: passed ?? false,
    label: label ?? null,
    details: details ?? "",
    cost: cost?.amount ?? 0,
    evaluation,
    datasetSlug,
    datasetId: dataset.id,
  });

  return answer(result, 200);
}

// ============ The three evaluate doors ============

/** The evaluator a request settled on: built-in, custom, or a saved workflow. */
type ResolvedEvaluatorDefinition =
  | EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS>
  | CustomEvaluatorDefinition;

/** What resolving `{evaluator}` settled, before any body is parsed. */
type ResolvedEvaluator = Readonly<{
  checkType: string;
  settings?: Record<string, unknown> | undefined;
  name?: string | undefined;
  savedEvaluatorId?: string | undefined;
  workflowDefinition?: Readonly<{ name: string; requiredFields: string[] }> | undefined;
}>;

async function handleEvaluatorCall({
  app,
  raw,
  projectId,
  evaluatorSlug,
  asGuardrail,
}: {
  app: EvaluationApi;
  raw: string;
  projectId: string;
  evaluatorSlug: string;
  asGuardrail: boolean;
}): Promise<RestRawAnswer> {
  const body = parseJson(raw);

  if (!body) return answer({ message: "Bad request" }, 400);

  const saved = evaluatorSlug.startsWith("evaluators/")
    ? await resolveSavedEvaluator(app, projectId, evaluatorSlug)
    : await resolveMonitorEvaluator(app, projectId, evaluatorSlug);

  if ("refusal" in saved) return saved.refusal;

  const monitor = evaluatorSlug.startsWith("evaluators/")
    ? null
    : await app.findMonitorBySlug({ projectId, slug: evaluatorSlug });

  // Every legacy `langevals/pairwise_compare` dispatch — from a saved
  // evaluator, a monitor, or a bare slug — is transparently rerouted to
  // select_best_compare here.
  const isLegacyPairwiseDispatch = saved.checkType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  const checkType = resolveDispatchEvaluatorType(saved.checkType) ?? saved.checkType;

  const evaluatorDefinition =
    saved.workflowDefinition ??
    (await getEvaluatorIncludingCustom(app, projectId, checkType as EvaluatorTypes));

  if (!evaluatorDefinition) return answer({ error: `Evaluator not found: ${checkType}` }, 404);

  let params: EvaluationRESTParams;

  try {
    params = evaluationInputSchema.parse(body);
  } catch (error) {
    logInvalid({ error, projectId, message: "invalid evaluation params received" });

    return answer({ error: sentenceFor(error) }, 400);
  }

  const isGuardrail = !!(asGuardrail || params.as_guardrail);
  const disabled = disabledGuardrailAnswer({ monitor, isGuardrail });

  if (disabled) return disabled;

  if (body.settings?.trace_id) params.trace_id = body.settings.trace_id;

  const merged = await mergeEvaluatorSettings({
    app,
    projectId,
    checkType,
    params,
    saved,
    monitor,
    isLegacyPairwiseDispatch,
    evaluatorDefinition,
  });

  if ("refusal" in merged) return merged.refusal;

  let data: EvaluationDispatchData;

  try {
    data = getEvaluatorDataForParams(
      checkType,
      (isLegacyPairwiseDispatch
        ? translateLegacyPairwisePayload(params.data as Record<string, unknown>)
        : params.data) as Record<string, any>,
    );
  } catch (error) {
    logInvalid({ error, projectId, message: "invalid evaluation data received" });

    return answer({ error: sentenceFor(error) }, 400);
  }

  const missing = missingRequiredField({ evaluatorDefinition, data, projectId });

  if (missing) return missing;

  return runAndReport({
    app,
    projectId,
    checkType,
    data,
    settings: merged.settings,
    params,
    saved,
    monitor,
    isGuardrail,
  });
}

/**
 * A guardrail whose monitor an operator has switched off does not block the
 * request it was guarding: it skips, and says it passed.
 */
function disabledGuardrailAnswer({
  monitor,
  isGuardrail,
}: {
  monitor: EvaluationMonitorSummary | null;
  isGuardrail: boolean;
}): RestRawAnswer | null {
  if (!monitor || monitor.enabled || !isGuardrail) return null;

  return answer({ status: "skipped", details: `Guardrail is not enabled`, passed: true }, 200);
}

/** The `evaluators/{slug|id}` form, and the three refusals it can answer. */
async function resolveSavedEvaluator(
  app: EvaluationApi,
  projectId: string,
  evaluatorSlug: string,
): Promise<ResolvedEvaluator | { refusal: RestRawAnswer }> {
  const slugOrId = evaluatorSlug.replace("evaluators/", "");

  try {
    const resolved = await app.resolveSavedEvaluator({ idOrSlug: slugOrId, projectId });

    return {
      checkType: resolved.checkType,
      settings: resolved.settings,
      name: resolved.name,
      savedEvaluatorId: resolved.evaluatorId,
      workflowDefinition: resolved.requiredFields
        ? { name: resolved.name, requiredFields: resolved.requiredFields }
        : void 0,
    };
  } catch (error) {
    if (error instanceof EvaluatorNotFoundError) {
      return { refusal: answer({ error: `Evaluator not found with slug or id: ${slugOrId}` }, 404) };
    }

    if (error instanceof EvaluatorWorkflowNotFoundError) {
      return { refusal: answer({ error: error.message }, 404) };
    }

    if (error instanceof EvaluatorInvalidConfigError) {
      return { refusal: answer({ error: error.message }, 400) };
    }

    throw error;
  }
}

/** A monitor slug, or the bare evaluator id the slug was not. */
async function resolveMonitorEvaluator(
  app: EvaluationApi,
  projectId: string,
  evaluatorSlug: string,
): Promise<ResolvedEvaluator> {
  const monitor = await app.findMonitorBySlug({ projectId, slug: evaluatorSlug });

  if (!monitor) return { checkType: evaluatorSlug };

  return {
    checkType: monitor.checkType,
    settings: monitor.parameters as Record<string, unknown> | undefined,
    name: monitor.name,
  };
}

/**
 * The evaluator's own defaults, then the saved or monitor settings, then the
 * per-call overrides, parsed by the evaluator's settings schema.
 */
async function mergeEvaluatorSettings({
  app,
  projectId,
  checkType,
  params,
  saved,
  monitor,
  isLegacyPairwiseDispatch,
  evaluatorDefinition,
}: {
  app: EvaluationApi;
  projectId: string;
  checkType: string;
  params: EvaluationRESTParams;
  saved: ResolvedEvaluator;
  monitor: EvaluationMonitorSummary | null;
  isLegacyPairwiseDispatch: boolean;
  evaluatorDefinition: ResolvedEvaluatorDefinition;
}): Promise<{ settings: any } | { refusal: RestRawAnswer }> {
  const evaluatorSettingSchema = checkType.startsWith("custom/")
    ? undefined
    : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;
  const stored = ((saved.settings ?? monitor?.parameters) as any) ?? {};

  try {
    // NB: `select_best_compare`'s settings schema is non-strict, so a legacy
    // `swap_and_confirm` key with no equivalent field is silently dropped by
    // the parse below rather than translated.
    const mergedSettings = {
      // Custom evaluator definitions have no `settings` to derive defaults
      // from — getEvaluatorDefaultSettings returns {} for that arm instead of
      // crashing. (Workflow evaluators never reach it: this branch.)
      ...(!saved.workflowDefinition
        ? getEvaluatorDefaultSettings(
            evaluatorDefinition,
            await resolveEvaluatorSettingsDefaults(app, projectId),
            { defaultModel: DEFAULT_MODEL, embeddingsModel: DEFAULT_EMBEDDINGS_MODEL },
          )
        : {}),
      ...(stored as Record<string, unknown>),
      ...(params.settings ? params.settings : {}),
    };

    // Stripped AFTER the full merge — including `params.settings` — so a prompt
    // arriving via the request body can't bypass the strip the way stripping
    // only the pre-merge DB/monitor settings would.
    const { settings: finalSettings, droppedPrompt } = isLegacyPairwiseDispatch
      ? stripIncompatiblePairwisePrompt(mergedSettings)
      : { settings: mergedSettings, droppedPrompt: false };

    if (droppedPrompt) {
      logger.warn(
        { projectId, checkType: LEGACY_PAIRWISE_EVALUATOR_TYPE },
        "legacy pairwise_compare dispatch had a customized prompt with no {candidates} placeholder — dropping it in favor of select_best_compare's default rather than forwarding unrendered pairwise placeholders",
      );
    }

    return { settings: evaluatorSettingSchema?.parse(finalSettings) };
  } catch (error) {
    logInvalid({ error, projectId, message: "invalid settings received for the evaluator" });

    return {
      refusal: answer(
        { error: `Invalid settings for ${checkType} evaluator: ${sentenceFor(error)}` },
        400,
      ),
    };
  }
}

/** The first required field this input does not carry, as its own refusal. */
function missingRequiredField({
  evaluatorDefinition,
  data,
  projectId,
}: {
  evaluatorDefinition: ResolvedEvaluatorDefinition;
  data: EvaluationDispatchData;
  projectId: string;
}): RestRawAnswer | null {
  for (const requiredField of evaluatorDefinition.requiredFields) {
    if (data.data[requiredField] !== undefined && data.data[requiredField] !== null) continue;

    const handledError = new EvaluatorMissingFieldError(requiredField, evaluatorDefinition.name);

    logger.warn(
      { code: handledError.code, meta: handledError.meta, projectId },
      "missing required field for evaluator",
    );

    // `error` keeps carrying the human-readable message, matching this
    // endpoint's existing wire shape for external API consumers. `kind`/`meta`
    // are additive so the workbench client can build a friendly message
    // without depending on the message being a specific string. The wire field
    // is named `kind` for back-compat; it carries the HandledError `code`.
    return answer(
      { error: handledError.message, kind: handledError.code, meta: handledError.meta },
      handledError.httpStatus,
    );
  }

  return null;
}

/** The run, its cost, the verdict it reports, and the body the caller reads. */
async function runAndReport({
  app,
  projectId,
  checkType,
  data,
  settings,
  params,
  saved,
  monitor,
  isGuardrail,
}: {
  app: EvaluationApi;
  projectId: string;
  checkType: string;
  data: EvaluationDispatchData;
  settings: Record<string, unknown>;
  params: EvaluationRESTParams;
  saved: ResolvedEvaluator;
  monitor: EvaluationMonitorSummary | null;
  isGuardrail: boolean;
}): Promise<RestRawAnswer> {
  const evaluationId = params.evaluation_id ?? generate(EVALUATION_KSUID_PREFIX).toString();
  const evaluatorId =
    saved.savedEvaluatorId ??
    monitor?.id ??
    params.evaluator_id ??
    app.deriveEvaluatorId(params.name ?? checkType);
  const evaluatorName = saved.name;

  const runEval = () =>
    app.runEvaluator({
      projectId,
      evaluatorType: checkType as EvaluatorTypes,
      data,
      settings,
    });

  let result: SingleEvaluationResult;
  let costId: string | undefined;

  try {
    result = await runEval();

    if (timedOut(result)) result = await runEval();

    if ("cost" in result && result.cost) {
      const cost = await app.recordEvaluationCost({
        id: generate(COST_KSUID_PREFIX).toString(),
        projectId,
        costType: isGuardrail ? "GUARDRAIL" : "TRACE_CHECK",
        costName: evaluatorName ?? monitor?.name ?? checkType,
        referenceType: "CHECK",
        referenceId: evaluatorName ?? monitor?.id ?? checkType,
        amount: result.cost.amount,
        currency: result.cost.currency,
        extraInfo: { trace_id: params.trace_id },
      });

      costId = cost.id;
    }
  } catch (error) {
    logger.error({ err: error, projectId }, "error running evaluation");
    result = internalErrorResult(detailOf(error));
  }

  await reportVerdict({
    app,
    projectId,
    evaluationId,
    evaluatorId,
    evaluatorName: evaluatorName ?? monitor?.name ?? params.name ?? undefined,
    checkType,
    params,
    isGuardrail,
    result,
    costId,
  });

  return answer(publishedResult({ result, isGuardrail }), 200);
}

/** The verdict, on the pipeline every other evaluation travels on. */
async function reportVerdict({
  app,
  projectId,
  evaluationId,
  evaluatorId,
  evaluatorName,
  checkType,
  params,
  isGuardrail,
  result,
  costId,
}: {
  app: EvaluationApi;
  projectId: string;
  evaluationId: string;
  evaluatorId: string;
  evaluatorName: string | undefined;
  checkType: string;
  params: EvaluationRESTParams;
  isGuardrail: boolean;
  result: SingleEvaluationResult;
  costId: string | undefined;
}): Promise<void> {
  const details = "details" in result ? result.details : undefined;

  try {
    await app.reportEvaluation({
      tenantId: projectId,
      evaluationId,
      evaluatorId,
      evaluatorType: checkType,
      evaluatorName,
      traceId: params.trace_id ?? undefined,
      isGuardrail,
      status: result.status,
      // The custom-evaluator error path spreads the raw evaluator result
      // (`{ ...result, status: "error" }`), so `"score" in result` is NOT
      // protective here — gate on status instead (#6833).
      ...verdictOf(result),
      details,
      costId: costId ?? null,
      occurredAt: nowInstant().epochMilliseconds,
      error: result.status === "error" ? details : undefined,
    });
  } catch (eventError) {
    logger.error(
      { err: eventError, projectId, evaluationId },
      "Failed to emit evaluation reported event",
    );
  }
}

/** The verdict fields a completed run is allowed to publish. */
function verdictOf(
  result: SingleEvaluationResult,
): Readonly<{ score?: number; passed?: boolean; label?: string }> {
  if (result.status !== "processed") return {};

  return {
    score: typeof result.score === "number" ? result.score : undefined,
    passed: result.passed ?? undefined,
    label: result.label ?? undefined,
  };
}

/** The result as the caller reads it: no traceback, and a guardrail verdict. */
function publishedResult({
  result,
  isGuardrail,
}: {
  result: SingleEvaluationResult;
  isGuardrail: boolean;
}): EvaluationRESTResult {
  if (result.status === "error") {
    return {
      status: "error",
      error_type: "EVALUATOR_ERROR",
      details: result.details,
      ...(isGuardrail ? { passed: true } : {}),
    };
  }

  if (result.status === "skipped") {
    return {
      status: "skipped",
      details: result.details,
      // An evaluation that declines to score can still have spent money: the
      // comparison judge pays for both of its passes before finding they
      // disagree. Only the fields named here leave the boundary.
      ...(result.cost ? { cost: result.cost } : {}),
      ...(isGuardrail ? { passed: true } : {}),
    };
  }

  return { ...result, ...(isGuardrail ? { passed: result.passed ?? true } : {}) };
}

// ============ Shared helpers ============

/** The document, or nothing where the body was not a JSON object. */
function parseJson(raw: string): Record<string, any> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, any>)
      : null;
  } catch {
    return null;
  }
}

/** A refusal's sentence, whichever kind of failure produced it. */
function sentenceFor(error: unknown): string {
  if (error instanceof ZodErrorClass) return fromZodError(error).message;
  if (error instanceof Error) return error.message;

  return String(error);
}

/** One rejected input, with the zod issues a reader needs to find it. */
function logInvalid({
  error,
  projectId,
  message,
}: {
  error: unknown;
  projectId: string;
  message: string;
}): void {
  logger.error(
    {
      err: error,
      ...(error instanceof ZodErrorClass
        ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
        : {}),
      projectId,
    },
    message,
  );
}

/** A run that threw is an errored result, not a refusal. */
async function runOrReportInternalError(
  run: () => Promise<SingleEvaluationResult>,
): Promise<SingleEvaluationResult> {
  try {
    return await run();
  } catch (error) {
    return internalErrorResult(error instanceof Error ? error.message : "Internal error");
  }
}

/** An evaluator that ran out of time is retried exactly once. */
function timedOut(result: SingleEvaluationResult): boolean {
  if (result.status !== "error") return false;

  return result.details.toLowerCase().includes("timed out");
}

/** The evaluate doors publish a thrown string as the detail; the dataset door does not. */
function detailOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  return "Internal error";
}

function internalErrorResult(details: string): SingleEvaluationResult {
  return { status: "error", error_type: "INTERNAL_ERROR", details, traceback: [] };
}

export const getEvaluatorIncludingCustom = async (
  app: EvaluationApi,
  projectId: string,
  checkType: EvaluatorTypes,
): Promise<
  EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS> | CustomEvaluatorDefinition | undefined
> => {
  const availableCustomEvaluators = await app.listCustomEvaluators({ projectId });
  const customEntries: [string, CustomEvaluatorDefinition][] = [];

  for (const evaluator of availableCustomEvaluators) {
    const dsl = evaluator.versions[0]?.dsl;

    if (!dsl) continue;

    const cloned = JSON.parse(JSON.stringify(dsl)) as
      | { edges?: StudioEdge[]; nodes?: StudioNode[] }
      | undefined;
    const { inputs } = getInputsOutputs(cloned?.edges ?? [], cloned?.nodes ?? []);
    const requiredFields = inputs
      .map((input) => input.identifier)
      .filter((id): id is string => typeof id === "string");

    customEntries.push([`custom/${evaluator.id}`, { name: evaluator.name, requiredFields }]);
  }

  const availableEvaluators = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(customEntries),
  };

  return availableEvaluators[checkType];
};

/**
 * Resolves the project's cascade-configured DEFAULT and EMBEDDINGS models into
 * the `{ defaultModel, embeddingsModel }` shape `getEvaluatorDefaultSettings`
 * consumes for its `model` / `embeddings_model` fields.
 */
export const resolveEvaluatorSettingsDefaults = async (
  app: EvaluationApi,
  projectId: string,
): Promise<{ defaultModel: string | null; embeddingsModel: string | null }> => {
  const [defaultModel, embeddingsModel] = await Promise.all([
    app.findModelForFeature({ projectId, featureKey: "evaluator.create_default" }),
    app.findModelForFeature({
      projectId,
      featureKey: "analytics.topic_clustering_embeddings",
    }),
  ]);

  return { defaultModel, embeddingsModel };
};
