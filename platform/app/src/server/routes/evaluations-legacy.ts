/**
 * Hono routes for legacy evaluation endpoints.
 *
 * Replaces:
 * - src/pages/api/evaluations/list.ts
 * - src/pages/api/evaluations/[evaluator]/evaluate.ts
 * - src/pages/api/evaluations/[evaluator]/[subpath]/evaluate.ts
 * - src/pages/api/evaluations/batch/log_results.ts
 * - src/pages/api/guardrails/[evaluator]/evaluate.ts
 * - src/pages/api/dataset/evaluate.ts
 */

import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { JsonArray } from "@prisma/client/runtime/client";
import { TRPCError } from "@trpc/server";
import type { Edge, Node } from "@xyflow/react";
import type { Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { nanoid } from "nanoid";
import { type ZodError, ZodError as ZodErrorClass, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { fromZodError } from "zod-validation-error";
import { LEGACY_PAIRWISE_EVALUATOR_TYPE } from "~/experiments-v3/types";
import { resolveDispatchEvaluatorType } from "~/experiments-v3/utils/normalizeComparison";
import type { Project } from "~/generated/prisma/client";
import { CostReferenceType, CostType, ExperimentType } from "~/generated/prisma/client";
import { getInputsOutputs } from "@langwatch/workflow-contract";
import { findOrCreateExperiment } from "~/pages/api/experiment/init";
import type { Permission } from "~/server/api/rbac";
import { listCustomEvaluators } from "@langwatch/platform-api/app-trpc";
import { createServiceApp } from "~/server/api/security";
import {
  handlerManagedAuth,
  publicEndpoint,
} from "@langwatch/platform-api/app-rest";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { appFromContext } from "~/app/api/middleware/app-context";
import { EvaluatorMissingFieldError } from "~/server/app-layer/evaluations/errors";
import { prisma } from "~/server/db";
import { evaluatorDisplayName } from "@langwatch/evaluator-contract";
import {
  AVAILABLE_EVALUATORS,
  coerceEvaluatorScalar,
  type EvaluationResult,
  EvaluatorInvalidConfigError,
  type EvaluatorDefinition,
  EvaluatorNotFoundError,
  type EvaluatorTypes,
  EvaluatorWorkflowNotFoundError,
  evaluatorsSchema,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  type CustomEvaluatorDefinition,
  getEvaluatorDefaultSettings,
} from "@langwatch/evaluator-contract";
import { type DataForEvaluation, runEvaluation } from "~/server/evaluations/runEvaluation";
import {
  type EvaluationRESTParams,
  type EvaluationRESTResult,
  evaluationInputSchema,
} from "~/server/evaluations/types";
import { CODE_EVALUATOR_CHECK_PREFIX } from "@langwatch/evaluator-contract";
import {
  type ESBatchEvaluation,
  type ESBatchEvaluationRESTParams,
  type ESBatchEvaluationTarget,
  type ESBatchEvaluationTargetType,
  eSBatchEvaluationRESTParamsSchema,
  eSBatchEvaluationSchema,
  eSBatchEvaluationTargetTypeSchema,
  mapLegacyExperimentTargets,
} from "@langwatch/experiment-contract";
import { getPayloadSizeHistogram } from "~/server/metrics";
import {
  ModelNotConfiguredError,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { evaluationNameAutoslug } from "~/server/tracer/collector/evaluationNameAutoslug";
import { extractChunkTextualContent } from "~/server/tracer/collector/rag";
import { rAGChunkSchema } from "@langwatch/trace-contract";
import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL, KSUID_RESOURCES } from "~/utils/constants";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { bodyLimit } from "./_lib/body-limit";
import {
  datasetEvaluateRequestSchema,
  evaluateErrorSchema,
  evaluateRequestSchema,
  evaluateResponseSchema,
  evaluatorCatalogueResponseSchema,
} from "./evaluations-legacy.schemas";
import {
  acknowledgementSchema,
  legacySentenceErrorSchema,
  requestBodySchema,
} from "./misc.schemas";

const logger = createLogger("langwatch:evaluations-legacy");
const AUTH_REASON = "project API key resolved in-handler";

// The static evaluator catalogue: the same list for every caller, with no
// project data in it. The declared policy says `public` rather than `apiKey`
// because that is what the handler enforces — it never resolves a token — and
// a declaration nobody checks is worse than none: it reads as a credential
// requirement to anyone auditing the registry while letting an unauthenticated
// request straight through. Tightening it would break the SDKs that read the
// catalogue before they have a key, which is the call this endpoint exists for.
const catalogueAuth = publicEndpoint(
  "static evaluator catalogue; the same list for every caller, no project data",
);
// Every other legacy route runs or records an evaluation.
//
// NOTE: these ask for `evaluations:manage` on what are append/create actions —
// the same over-coarse grain that `POST /api/experiments/:slug/run` had, which
// refuses any least-privilege key holding only `evaluations:create`. Declaring
// it here does not fix it; it makes it VISIBLE, which is the precondition.
// Tracked separately rather than widened in this change.
const legacyEvaluationAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["evaluations:manage"],
  credential: "apiKey",
});

/**
 * Authenticates via the unified API-key + legacy-key path and enforces the given
 * permission ceiling. Returns either a `{ project, markUsed }` context on
 * success or `{ error, status, body }` for the caller to short-circuit with
 * c.json(...) — `body` is a bare sentence for an unauthenticated call, and the
 * full handled payload (code, permission, tips) for a permission denial.
 * `markUsed` is a no-op for legacy keys and a fire-and-forget lastUsedAt bump
 * for API keys — callers invoke it after building a success response.
 */
async function authenticateRequest(
  c: Context,
  permission: Permission,
): Promise<
  | {
      project: Project & { team?: { id: string; organizationId: string } };
      markUsed: () => void;
    }
  | { error: string; status: 401 | 403; body: object }
> {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    const message =
      "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).";
    return { error: message, status: 401, body: { message } };
  }

  const apiKeys = appFromContext(c).apiKeys;
  const resolved = await apiKeys.tryResolveToken({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    const message = "Invalid auth token.";
    return { error: message, status: 401, body: { message } };
  }

  try {
    await enforceApiKeyCeiling({ resolved, permission });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    // The ceiling only ever denies with 403; narrowed here so the descriptor
    // keeps its `401 | 403` contract with the routes.
    return { error: denial.message, status: 403, body: denial.body };
  }

  const markUsed = () => {
    if (resolved.type === "apiKey") {
      apiKeys.markUsed({ id: resolved.apiKeyId });
    }
  };

  return { project: resolved.project, markUsed };
}

const secured = createServiceApp({ basePath: "/api" });

// ---------- GET /api/evaluations/list ----------
/**
 * The catalogue, built once.
 *
 * `zodToJsonSchema` over ~40 settings schemas is not free, and the answer is
 * the same for every caller on every request: the evaluator list is compiled
 * in. Building it per request turned an unauthenticated endpoint into a CPU
 * amplifier; building it once at first use costs one pass for the life of the
 * process.
 */
let evaluatorCatalogue: Record<string, unknown> | undefined;

const buildEvaluatorCatalogue = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(AVAILABLE_EVALUATORS)
      .filter(
        ([key]) =>
          !key.startsWith("example/") &&
          key !== "aws/comprehend_pii_detection" &&
          key !== "google_cloud/dlp_pii_detection",
      )
      .map(([key, value]) => [
        key,
        {
          ...value,
          name: evaluatorDisplayName(value.name),
          settings_json_schema: zodToJsonSchema(
            // @ts-expect-error `key` indexes the union of every evaluator
            // type, so `.shape.settings` resolves to a heterogeneous union
            // that zodToJsonSchema accepts at runtime but TS can't narrow.
            evaluatorsSchema.shape[key].shape.settings,
          ),
        },
      ]),
  );

secured.access(catalogueAuth).get(
  "/evaluations/list",
  describeRoute({
    summary: "List the built-in evaluators",
    description:
      "List every evaluator this server ships with, along with the `data` fields each one needs and the settings it accepts. The keys of `evaluators` are the ids you put in the evaluate path. The list is the same for every caller and needs no credential.",
    tags: ["Evaluations"],
    // Overrides the document's root requirement: this endpoint takes no
    // credential, and declaring one it does not check would be a fiction.
    security: [],
    responses: {
      200: {
        description: "The evaluator catalogue",
        content: {
          "application/json": {
            schema: resolver(evaluatorCatalogueResponseSchema),
          },
        },
      },
    },
  }),
  (c) => {
    evaluatorCatalogue ??= buildEvaluatorCatalogue();
    return c.json({ evaluators: evaluatorCatalogue });
  },
);

// ---------- POST /api/evaluations/batch/log_results ----------
secured.access(legacyEvaluationAuth).post(
  "/evaluations/batch/log_results",
  describeRoute({
    summary: "Report batch evaluation results",
    description:
      "Report the rows of a batch evaluation against an experiment, so its scores and progress show up in the app. This is the second half of an SDK batch evaluation: create the experiment with `POST /api/experiment/init`, then post rows here as they finish. Identify the experiment by either `experiment_id` or `experiment_slug`. Bodies up to 20MB are accepted.",
    tags: ["Evaluations"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(eSBatchEvaluationRESTParamsSchema),
        },
      },
    },
    responses: {
      200: {
        description: "The rows were recorded",
        content: {
          "application/json": { schema: resolver(acknowledgementSchema) },
        },
      },
      400: {
        description:
          "The request was not sent as application/json, failed validation, named neither experiment_id nor experiment_slug, or carried timestamps in seconds rather than milliseconds",
        content: {
          "application/json": {
            schema: resolver(legacySentenceErrorSchema),
          },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": { schema: resolver(evaluateErrorSchema) },
        },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: {
          "application/json": { schema: resolver(evaluateErrorSchema) },
        },
      },
    },
  }),
  bodyLimit({ maxSize: 20 * 1024 * 1024 }),
  async (c) => {
    const auth = await authenticateRequest(c, "evaluations:manage");
    if ("error" in auth) {
      return c.json(auth.body, auth.status);
    }
    const { project, markUsed } = auth;

    const contentType = c.req.header("content-type");
    if (!contentType?.includes("application/json")) {
      logger.warn(
        {
          contentType,
        },
        "log_results request body is not json",
      );
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    let body: Record<string, any>;
    let payloadSize: number;
    try {
      // Size comes from the wire bytes, not a re-serialisation of the parsed
      // body — these payloads carry full dataset entries and LLM outputs.
      const raw = await c.req.text();
      payloadSize = Buffer.byteLength(raw, "utf8");
      body = JSON.parse(raw);
    } catch {
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    getPayloadSizeHistogram("log_results").observe(payloadSize);

    let params: ESBatchEvaluationRESTParams;
    try {
      params = eSBatchEvaluationRESTParamsSchema.parse(body);
    } catch (error) {
      logger.error(
        { error, payloadSize, projectId: project.id },
        "invalid log_results data received",
      );
      captureException(toError(error), { extra: { projectId: project.id } });
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }

    if (!params.experiment_id && !params.experiment_slug) {
      logger.warn(
        { runId: params.run_id },
        "log_results missing experiment_id and experiment_slug",
      );
      return c.json({ error: "Either experiment_id or experiment_slug is required" }, 400);
    }

    if (params.timestamps?.created_at && params.timestamps.created_at.toString().length === 10) {
      return c.json(
        {
          error: "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
        },
        400,
      );
    }

    try {
      await processBatchEvaluation(c.app, project, params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error(
          { error, runId: params.run_id, projectId: project.id },
          "failed to validate data for batch evaluation",
        );
        captureException(toError(error), {
          extra: { projectId: project.id, runId: params.run_id },
        });
        const validationError = fromZodError(error);
        return c.json({ error: validationError.message }, 400);
      } else if (HandledError.isHandled(error)) {
        logger.warn(
          { code: error.code, meta: error.meta, projectId: project.id },
          "handled error processing batch evaluation",
        );
        return c.json({ error: error.code, message: error.message }, error.httpStatus as 400);
      } else {
        logger.error(
          { error, runId: params.run_id, projectId: project.id },
          "internal server error processing batch evaluation",
        );
        captureException(toError(error), {
          extra: { projectId: project.id, runId: params.run_id },
        });
        return c.json(
          {
            error: error instanceof Error ? error.message : "Internal server error",
          },
          500,
        );
      }
    }

    markUsed();
    return c.json({ message: "ok" });
  },
);

/**
 * What every evaluate route documents.
 *
 * The three of them run one handler over one envelope, so they answer the same
 * shapes; only the path parameters and the wording differ.
 */
const evaluateResponses = {
  200: {
    description:
      "The evaluator ran, declined, or failed. Branch on `status`; in guardrail mode `passed` is set on all three.",
    content: {
      "application/json": { schema: resolver(evaluateResponseSchema) },
    },
  },
  400: {
    description:
      "The body was not valid JSON, failed validation, or omitted a field this evaluator requires",
    content: {
      "application/json": { schema: resolver(evaluateErrorSchema) },
    },
  },
  401: {
    description: "Missing or invalid API key",
    content: {
      "application/json": { schema: resolver(evaluateErrorSchema) },
    },
  },
  403: {
    description: "The API key lacks evaluations:manage",
    content: {
      "application/json": { schema: resolver(evaluateErrorSchema) },
    },
  },
  404: {
    description: "No evaluator answers to that id",
    content: {
      "application/json": { schema: resolver(evaluateErrorSchema) },
    },
  },
} as const;

const evaluateRequestBody = {
  required: true,
  content: {
    "application/json": { schema: requestBodySchema(evaluateRequestSchema) },
  },
};

/**
 * What goes in the `{evaluator}` slot. Not a closed set, and not enumerable
 * here: two of the three forms name rows in the caller's own project.
 */
const EVALUATOR_PARAM_DESCRIPTION =
  "Which evaluator to run. Either a built-in id (`ragas/faithfulness`), the slug of a monitor configured in this project, or `evaluators/{slug|id}` for a saved evaluator. `GET /api/evaluations/list` returns the built-in ids.";

// ---------- POST /api/evaluations/:evaluator/evaluate ----------
secured.access(legacyEvaluationAuth).post(
  "/evaluations/:evaluator/evaluate",
  describeRoute({
    summary: "Run an evaluator",
    description:
      "Run one evaluator over a single input and get its score back. Built-in evaluators whose id has two segments, such as `ragas/faithfulness`, are addressed with the two-segment form of this path. Bodies up to 30MB are accepted.",
    tags: ["Evaluations"],
    parameters: [
      {
        in: "path",
        name: "evaluator",
        required: true,
        schema: { type: "string" },
        description: EVALUATOR_PARAM_DESCRIPTION,
      },
    ],
    requestBody: evaluateRequestBody,
    responses: evaluateResponses,
  }),
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = c.req.param("evaluator");
    return handleEvaluatorCall(c, evaluatorSlug, false);
  },
);

// ---------- POST /api/evaluations/:evaluator/:subpath/evaluate ----------
secured.access(legacyEvaluationAuth).post(
  "/evaluations/:evaluator/:subpath/evaluate",
  describeRoute({
    summary: "Run a namespaced evaluator",
    description:
      "Run one evaluator whose id has two segments, such as `ragas/faithfulness` or `langevals/valid_format`. Identical to the single-segment form in every other respect; the id is simply split across two path segments.",
    tags: ["Evaluations"],
    parameters: [
      {
        in: "path",
        name: "evaluator",
        required: true,
        schema: { type: "string" },
        description: "First segment of the evaluator id, such as `ragas`",
      },
      {
        in: "path",
        name: "subpath",
        required: true,
        schema: { type: "string" },
        description: "Second segment of the evaluator id, such as `faithfulness`",
      },
    ],
    requestBody: evaluateRequestBody,
    responses: evaluateResponses,
  }),
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = `${c.req.param("evaluator")}/${c.req.param("subpath")}`;
    return handleEvaluatorCall(c, evaluatorSlug, false);
  },
);

// ---------- POST /api/guardrails/:evaluator/evaluate ----------
secured.access(legacyEvaluationAuth).post(
  "/guardrails/:evaluator/evaluate",
  describeRoute({
    summary: "Run an evaluator as a guardrail",
    description:
      "Run an evaluator inline and gate on one boolean. Same call as the evaluate path with `as_guardrail` set: every outcome carries `passed`, so an evaluator that skips or fails does not block the request it was guarding. Check `passed` and let the request through when it is true.",
    tags: ["Evaluations"],
    parameters: [
      {
        in: "path",
        name: "evaluator",
        required: true,
        schema: { type: "string" },
        description: EVALUATOR_PARAM_DESCRIPTION,
      },
    ],
    requestBody: evaluateRequestBody,
    responses: evaluateResponses,
  }),
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = c.req.param("evaluator");
    return handleEvaluatorCall(c, evaluatorSlug, true);
  },
);

// ---------- POST /api/dataset/evaluate ----------
secured.access(legacyEvaluationAuth).post(
  "/dataset/evaluate",
  describeRoute({
    summary: "Evaluate a dataset",
    description:
      "Run one evaluator across a saved dataset and record the result against an experiment. Name the dataset by slug and the evaluator the same way the evaluate endpoints do; results are grouped under `experimentSlug`, or under a generated batch id when you omit it. Bodies up to 30MB are accepted.",
    tags: ["Datasets"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(datasetEvaluateRequestSchema),
        },
      },
    },
    responses: {
      200: {
        description: "The evaluator ran; branch on `status`",
        content: {
          "application/json": { schema: resolver(evaluateResponseSchema) },
        },
      },
      400: {
        description:
          "The body was not valid JSON, failed validation, or named an evaluator that does not exist",
        content: {
          "application/json": { schema: resolver(legacySentenceErrorSchema) },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": { schema: resolver(legacySentenceErrorSchema) },
        },
      },
      403: {
        description: "The API key lacks evaluations:manage",
        content: {
          "application/json": { schema: resolver(evaluateErrorSchema) },
        },
      },
      404: {
        description: "No dataset with that slug",
        content: {
          "application/json": { schema: resolver(evaluateErrorSchema) },
        },
      },
      413: {
        description:
          "The body is larger than 30MB. Refused before it is read, so the response is the plain sentence `Payload Too Large` rather than a JSON error",
        content: {
          "text/plain": { schema: { type: "string" } },
        },
      },
    },
  }),
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const auth = await authenticateRequest(c, "evaluations:manage");
    if ("error" in auth) {
      return c.json(auth.body, auth.status);
    }
    const { markUsed } = auth;
    // dataset/evaluate needs the full team relation for downstream queries.
    const project = await prisma.project.findUnique({
      where: { id: auth.project.id },
      include: { team: true },
    });
    if (!project) {
      return c.json({ message: "Invalid auth token." }, 401);
    }

    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

    let params: BatchEvaluationRESTParams;
    try {
      params = batchEvaluationInputSchema.parse(body);
    } catch (error) {
      logger.error({ error, projectId: project.id }, "invalid evaluation params received");
      captureException(toError(error), { extra: { projectId: project.id } });
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }

    const { datasetSlug } = params;
    const experimentSlug = params.experimentSlug ?? params.batchId ?? nanoid();
    const evaluation = params.evaluation;
    let settings = null;
    let checkType;

    const check = await prisma.monitor.findFirst({
      where: { projectId: project.id, slug: evaluation },
    });

    if (check != null) {
      checkType = check.checkType;
      settings = check.parameters;
    } else {
      checkType = evaluation;
    }

    const evaluator = await getEvaluatorIncludingCustom(project.id, checkType as EvaluatorTypes);
    if (!evaluator) {
      return c.json({ error: `Evaluator not found: ${checkType}` }, 400);
    }

    let data: DataForEvaluation;
    try {
      data = getEvaluatorDataForParams(checkType, params.data as Record<string, any>);
      if (!evaluator.requiredFields.every((field: string) => field in data.data)) {
        return c.json(
          {
            error: `Missing required field for ${checkType}`,
            requiredFields: evaluator.requiredFields,
          },
          400,
        );
      }
    } catch (error) {
      logger.error({ error, body, projectId: project.id }, "invalid evaluation data received");
      captureException(toError(error), { extra: { projectId: project.id } });
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }

    const dataset = await prisma.dataset.findFirst({
      where: { slug: datasetSlug, projectId: project.id },
    });
    if (!dataset) {
      return c.json({ error: "Dataset not found" }, 404);
    }

    let result: SingleEvaluationResult;
    try {
      result = await runEvaluation({
        projectId: project.id,
        data,
        evaluatorType: checkType as EvaluatorTypes,
        settings: (settings as Record<string, unknown>) ?? {},
        modelProviders: c.app.modelProviders,
        managedProviders: c.app.managedProviders,
        workflows: c.app.workflows,
        evaluators: c.app.evaluators,
      });
    } catch (error) {
      result = {
        status: "error",
        error_type: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : "Internal error",
        traceback: [],
      };
    }

    const experiment = await c.app.experiments.tryGetBySlug({
      projectId: project.id,
      slug: experimentSlug,
    });
    if (!experiment) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Experiment not found",
      });
    }

    if ("cost" in result && result.cost) {
      await prisma.cost.create({
        data: {
          id: `cost_${nanoid()}`,
          projectId: project.id,
          costType: CostType.BATCH_EVALUATION,
          costName: evaluation,
          referenceType: CostReferenceType.BATCH,
          referenceId: experiment.id,
          amount: result.cost.amount,
          currency: result.cost.currency,
        },
      });
    }

    const { score, passed, details, cost, status, label } = result as EvaluationResult;

    await prisma.batchEvaluation.create({
      data: {
        id: nanoid(),
        experimentId: experiment.id,
        projectId: project.id,
        data: data.data,
        status,
        score: score ?? 0,
        passed: passed ?? false,
        label,
        details: details ?? "",
        cost: cost?.amount ?? 0,
        evaluation,
        datasetSlug,
        datasetId: dataset.id,
      },
    });

    markUsed();
    return c.json(result);
  },
);

export const app = secured.hono;

// ============ Shared helpers ============

const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.object({}).passthrough().optional().nullable(),
  settings: z.object({}).passthrough().optional().nullable(),
});

type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

const coercedString = z.preprocess(coerceEvaluatorScalar, z.string().optional().nullable());

const defaultEvaluatorInputSchema = z.object({
  input: coercedString,
  output: coercedString,
  contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  expected_output: coercedString,
  expected_contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  conversation: z
    .array(
      z.object({
        input: coercedString,
        output: coercedString,
      }),
    )
    .optional()
    .nullable(),
});

const autoparseContexts = (contexts: unknown[] | unknown): string[] | undefined => {
  if (contexts === null || contexts === undefined) return undefined;
  const parsedContexts = Array.isArray(contexts) ? contexts : [contexts];
  return parsedContexts.map((context) => {
    if (typeof context === "string") return context;
    return extractChunkTextualContent("content" in context ? context.content : context);
  });
};

export const getEvaluatorDataForParams = (
  checkType: string,
  params: Record<string, any>,
): DataForEvaluation => {
  if (checkType.startsWith("custom/") || checkType.startsWith(CODE_EVALUATOR_CHECK_PREFIX)) {
    return { type: "custom", data: params };
  }

  const data_ = defaultEvaluatorInputSchema.parse({
    ...params,
    contexts: autoparseContexts(params.contexts),
    expected_contexts: autoparseContexts(params.expected_contexts),
  });

  // Preserve evaluator-specific fields (e.g. pairwise's candidate_a_id /
  // candidate_a_output) that the legacy default schema strips. Bounded
  // to the evaluator's declared required + optional fields so a stray
  // mapping output on a non-pairwise evaluator can't ride through and
  // trip a strict pydantic model on the langevals side — the spread is
  // opt-in per evaluator, not a catch-all. The canonical 6 fields are
  // normalized below; everything else listed in the evaluator's
  // contract passes through as-is.
  const canonicalKeys = new Set([
    "input",
    "output",
    "contexts",
    "expected_output",
    "expected_contexts",
    "conversation",
  ]);
  const evaluatorContract = AVAILABLE_EVALUATORS[checkType as EvaluatorTypes];
  const allowedExtras = new Set([
    ...(evaluatorContract?.requiredFields ?? []),
    ...(evaluatorContract?.optionalFields ?? []),
  ]);
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (canonicalKeys.has(key)) continue;
    if (!allowedExtras.has(key)) continue;
    extras[key] = value;
  }

  return {
    type: "default",
    data: {
      ...extras,
      input: data_.input ? data_.input : undefined,
      output: data_.output ? data_.output : undefined,
      contexts: JSON.stringify(data_.contexts),
      expected_output: data_.expected_output ? data_.expected_output : undefined,
      expected_contexts: JSON.stringify(data_.expected_contexts),
      conversation: JSON.stringify(
        data_.conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? [],
      ),
    },
  };
};

/**
 * Translates a legacy 2-slot pairwise payload (`candidate_a_id` /
 * `candidate_a_output` / ... `candidate_b_*`) into the N-way `candidates`
 * shape `langevals/select_best_compare` expects. The payload half of
 * `resolveDispatchEvaluatorType`'s redirect — the two travel together, at
 * the same call site, so they cannot disagree the way orchestrator.ts and
 * the old dispatch logic once did (#5528).
 *
 * A slot with no `candidate_*_id` is dropped rather than sent as an empty
 * candidate — an incomplete legacy config should surface as "missing
 * candidate output" the same way a native comparison with a missing variant
 * does, not as a judge call over a blank second candidate.
 */
export const translateLegacyPairwisePayload = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const {
    candidate_a_id,
    candidate_a_output,
    candidate_a_cost,
    candidate_a_duration,
    candidate_b_id,
    candidate_b_output,
    candidate_b_cost,
    candidate_b_duration,
    ...rest
  } = data;

  const candidates = [
    candidate_a_id !== undefined
      ? {
          id: candidate_a_id,
          output: candidate_a_output,
          cost: candidate_a_cost,
          duration: candidate_a_duration,
        }
      : undefined,
    candidate_b_id !== undefined
      ? {
          id: candidate_b_id,
          output: candidate_b_output,
          cost: candidate_b_cost,
          duration: candidate_b_duration,
        }
      : undefined,
  ].filter((candidate) => candidate !== undefined);

  return { ...rest, candidates };
};

/**
 * Removes a legacy pairwise `prompt` setting that select_best_compare cannot
 * render. The pairwise judge's template uses `{candidate_a_output}` /
 * `{candidate_b_output}` slots; the N-way judge only substitutes
 * `{candidates}` (plus `{input}` / `{golden}`). A saved prompt with no
 * `{candidates}` placeholder — including pairwise's own untouched default —
 * would reach the new judge with its instructions half-literal, so it's
 * dropped, letting the caller fall back to select_best_compare's default.
 *
 * A prompt that DOES contain `{candidates}` is kept: a user who already
 * migrated their wording to the new placeholder should keep it.
 * `droppedPrompt` is returned (rather than logged in here) so the caller owns
 * the log context, and pure-function tests stay dependency-free.
 */
export const stripIncompatiblePairwisePrompt = (
  settings: Record<string, unknown>,
): { settings: Record<string, unknown>; droppedPrompt: boolean } => {
  if (typeof settings.prompt === "string" && !settings.prompt.includes("{candidates}")) {
    const { prompt: _incompatible, ...rest } = settings;
    return { settings: rest, droppedPrompt: true };
  }
  return { settings, droppedPrompt: false };
};

export const getEvaluatorIncludingCustom = async (
  projectId: string,
  checkType: EvaluatorTypes,
): Promise<
  EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS> | CustomEvaluatorDefinition | undefined
> => {
  const availableCustomEvaluators = await listCustomEvaluators({
    prisma,
    projectId,
  });

  const customEntries: [string, CustomEvaluatorDefinition][] = [];
  for (const evaluator of availableCustomEvaluators ?? []) {
    const dsl = evaluator.versions[0]?.dsl;
    if (!dsl) {
      continue;
    }
    const cloned = JSON.parse(JSON.stringify(dsl)) as
      | { edges?: Edge[]; nodes?: unknown[] }
      | undefined;
    const { inputs } = getInputsOutputs(
      (cloned?.edges ?? []) as Edge[],
      (cloned?.nodes ?? []) as JsonArray as unknown[] as Node[],
    );
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
 * Resolves the project's cascade-configured DEFAULT and EMBEDDINGS models
 * into the `{ defaultModel, embeddingsModel }` shape that
 * `getEvaluatorDefaultSettings` consumes for its `model` / `embeddings_model`
 * fields.
 *
 * Without this, the legacy REST route fell through to the hardcoded global
 * `DEFAULT_MODEL` (`getLatestOpenAIChatFlagship()`), bypassing the project's
 * model cascade entirely for every API-triggered evaluation (issue #5468).
 *
 * The feature keys match the server-side evaluator-create path in
 * `app/api/evaluators/.../app.v1.ts` (`evaluator.create_default` for the LLM
 * model, `analytics.topic_clustering_embeddings` for the embeddings model).
 * When the cascade has nothing configured at any scope, the resolver returns
 * `null` and `getEvaluatorDefaultSettings` keeps the global fallback — no
 * regression for projects without a custom default.
 */
export const resolveEvaluatorSettingsDefaults = async (
  projectId: string,
  modelProviders: ModelProviderService,
): Promise<{ defaultModel: string | null; embeddingsModel: string | null }> => {
  const resolveConfiguredModel = async (featureKey: string): Promise<string | null> => {
    try {
      const resolution = await modelProviders.resolveModelForFeature({
        projectId,
        featureKey,
      });

      return resolution.model;
    } catch (error) {
      if (error instanceof ModelNotConfiguredError) {
        return null;
      }

      throw error;
    }
  };

  const [defaultModel, embeddingsModel] = await Promise.all([
    resolveConfiguredModel("evaluator.create_default"),
    resolveConfiguredModel("analytics.topic_clustering_embeddings"),
  ]);

  return { defaultModel, embeddingsModel };
};

// --- Evaluator call handler (used by evaluations + guardrails routes) ---

/**
 * The verdict fields of a `reportEvaluation` payload, gated on the run
 * actually completing. A verdict is only real when the evaluator ran to
 * completion — an errored/skipped run's stray passed/score/label must not
 * reach analytics or triggers as a real result (#6833). Same gate as the
 * shared verdictGate helpers applied at the executeEvaluation command
 * boundary. Property presence is no defense: the custom-evaluator error
 * path spreads the raw evaluator result, so score/passed survive on it.
 */
function gatedVerdictFields(result: {
  status: string;
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
}): { score?: number; passed?: boolean; label?: string } {
  if (result.status !== "processed") return {};
  return {
    score: typeof result.score === "number" ? result.score : undefined,
    passed: result.passed ?? undefined,
    label: result.label ?? undefined,
  };
}

async function handleEvaluatorCall(c: Context, evaluatorSlug: string, as_guardrail: boolean) {
  const auth = await authenticateRequest(c, "evaluations:manage");
  if ("error" in auth) {
    return c.json(auth.body, auth.status);
  }
  const { project, markUsed } = auth;

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  let checkType: string;
  let evaluatorSettings: Record<string, unknown> | undefined;
  let evaluatorName: string | undefined;
  let savedEvaluatorId: string | undefined;
  let workflowEvaluatorDef: { name: string; requiredFields: string[] } | undefined;

  if (evaluatorSlug.startsWith("evaluators/")) {
    const slugOrId = evaluatorSlug.replace("evaluators/", "");
    try {
      const resolved = await c.app.evaluators.resolveForExecution({
        idOrSlug: slugOrId,
        projectId: project.id,
      });
      checkType = resolved.checkType;
      evaluatorSettings = resolved.settings;
      evaluatorName = resolved.name;
      savedEvaluatorId = resolved.evaluatorId;
      workflowEvaluatorDef = resolved.requiredFields
        ? { name: resolved.name, requiredFields: resolved.requiredFields }
        : void 0;
    } catch (error) {
      if (error instanceof EvaluatorNotFoundError) {
        return c.json({ error: `Evaluator not found with slug or id: ${slugOrId}` }, 404);
      }
      if (error instanceof EvaluatorWorkflowNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof EvaluatorInvalidConfigError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  } else {
    const monitor = await prisma.monitor.findUnique({
      where: {
        projectId_slug: { projectId: project.id, slug: evaluatorSlug },
      },
    });
    if (monitor != null) {
      checkType = monitor.checkType;
      evaluatorSettings = monitor.parameters as Record<string, unknown> | undefined;
      evaluatorName = monitor.name;
    } else {
      checkType = evaluatorSlug;
    }
  }

  const monitor = !evaluatorSlug.startsWith("evaluators/")
    ? await prisma.monitor.findUnique({
        where: {
          projectId_slug: { projectId: project.id, slug: evaluatorSlug },
        },
      })
    : null;

  // Every legacy `langevals/pairwise_compare` dispatch — from a saved
  // evaluator, a monitor, or a bare slug — is transparently rerouted to
  // select_best_compare here. This is the ONE place that makes that call
  // (see resolveDispatchEvaluatorType's JSDoc), so a caller upstream (the
  // Experiments Workbench orchestrator, a monitor's scheduled run) never
  // needs to know the redirect happened; it keeps sending the 2-slot wire
  // shape it always has, and isLegacyPairwiseDispatch below decides whether
  // that shape needs translating before it reaches the new judge.
  const isLegacyPairwiseDispatch = checkType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
  checkType = resolveDispatchEvaluatorType(checkType) ?? checkType;

  const evaluatorDefinition =
    workflowEvaluatorDef ??
    (await getEvaluatorIncludingCustom(project.id, checkType as EvaluatorTypes));
  if (!evaluatorDefinition) {
    return c.json({ error: `Evaluator not found: ${checkType}` }, 404);
  }

  let params: EvaluationRESTParams;
  try {
    params = evaluationInputSchema.parse(body);
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation params received",
    );
    captureException(toError(error), {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json({ error: message }, 400);
  }

  const isGuardrail = as_guardrail || params.as_guardrail;

  if (monitor && !monitor.enabled && !!isGuardrail) {
    return c.json({
      status: "skipped",
      details: `Guardrail is not enabled`,
      ...(isGuardrail ? { passed: true } : {}),
    });
  }

  if (body.settings?.trace_id) {
    params.trace_id = body.settings.trace_id;
  }

  const evaluatorSettingSchema = checkType.startsWith("custom/")
    ? undefined
    : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;

  let settings: any = ((evaluatorSettings ?? monitor?.parameters) as any) ?? {};

  try {
    // NB: `select_best_compare`'s settings schema is non-strict, so a legacy
    // `swap_and_confirm` key with no equivalent field is silently dropped by
    // the parse below rather than translated — `randomize_order` then falls
    // back to its own default (`true`). Both fields default `true`, so this
    // only differs for a legacy row that explicitly set
    // `swap_and_confirm: false`; that row's candidate-ordering behavior
    // flips silently on reroute. Narrow enough (and low-impact enough) to
    // document rather than special-case.
    const mergedSettings = {
      // Custom evaluator definitions have no `settings` to derive defaults
      // from — getEvaluatorDefaultSettings returns {} for that arm instead of
      // crashing. (Workflow evaluators never reach it: this branch.)
      ...(!workflowEvaluatorDef
        ? getEvaluatorDefaultSettings(
            evaluatorDefinition,
            await resolveEvaluatorSettingsDefaults(project.id, c.app.modelProviders),
            {
              defaultModel: DEFAULT_MODEL,
              embeddingsModel: DEFAULT_EMBEDDINGS_MODEL,
            },
          )
        : {}),
      ...(settings as Record<string, unknown>),
      ...(params.settings ? params.settings : {}),
    };

    // Drop a legacy pairwise `prompt` that can't render on the new judge (see
    // stripIncompatiblePairwisePrompt), so select_best_compare's own default
    // wins instead of forwarding unrendered pairwise placeholders. Stripped
    // AFTER the full merge — including `params.settings` — so a prompt
    // arriving via the request body can't bypass the strip the way stripping
    // only the pre-merge DB/monitor settings would.
    const { settings: finalSettings, droppedPrompt } = isLegacyPairwiseDispatch
      ? stripIncompatiblePairwisePrompt(mergedSettings)
      : { settings: mergedSettings, droppedPrompt: false };
    if (droppedPrompt) {
      logger.warn(
        { projectId: project.id, checkType: LEGACY_PAIRWISE_EVALUATOR_TYPE },
        "legacy pairwise_compare dispatch had a customized prompt with no {candidates} placeholder — dropping it in favor of select_best_compare's default rather than forwarding unrendered pairwise placeholders",
      );
    }

    settings = evaluatorSettingSchema?.parse(finalSettings);
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid settings received for the evaluator",
    );
    captureException(toError(error), {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json(
      {
        error: `Invalid settings for ${checkType} evaluator: ${message}`,
      },
      400,
    );
  }

  let data: DataForEvaluation;
  try {
    data = getEvaluatorDataForParams(
      checkType,
      (isLegacyPairwiseDispatch
        ? translateLegacyPairwisePayload(params.data as Record<string, any>)
        : params.data) as Record<string, any>,
    );
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation data received",
    );
    captureException(toError(error), {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json({ error: message }, 400);
  }

  for (const requiredField of evaluatorDefinition.requiredFields) {
    if (data.data[requiredField] === undefined || data.data[requiredField] === null) {
      const handledError = new EvaluatorMissingFieldError(requiredField, evaluatorDefinition.name);
      logger.warn(
        {
          code: handledError.code,
          meta: handledError.meta,
          projectId: project.id,
        },
        "missing required field for evaluator",
      );
      return c.json(
        {
          // `error` keeps carrying the human-readable message, matching
          // this endpoint's existing wire shape for external API consumers.
          // `kind`/`meta` are additive so the workbench client can build a
          // friendly message (e.g. map candidate_a_id -> "Variant A")
          // without depending on the message being a specific string. The
          // wire field is named `kind` for back-compat; it carries the
          // HandledError `code`.
          error: handledError.message,
          kind: handledError.code,
          meta: handledError.meta,
        },
        handledError.httpStatus as 400,
      );
    }
  }

  let result: SingleEvaluationResult;
  let costId: string | undefined;

  const evaluationId = params.evaluation_id ?? generate(KSUID_RESOURCES.EVALUATION).toString();
  const evaluatorId =
    savedEvaluatorId ??
    monitor?.id ??
    params.evaluator_id ??
    evaluationNameAutoslug(params.name ?? checkType);

  const runEval = () =>
    runEvaluation({
      projectId: project.id,
      evaluatorType: checkType as EvaluatorTypes,
      data,
      settings,
      modelProviders: c.app.modelProviders,
      managedProviders: c.app.managedProviders,
      workflows: c.app.workflows,
      evaluators: c.app.evaluators,
    });

  try {
    result = await runEval();

    if (result.status === "error" && result.details.toLowerCase().includes("timed out")) {
      result = await runEval();
    }

    if ("cost" in result && result.cost) {
      const cost = await prisma.cost.create({
        data: {
          id: generate(KSUID_RESOURCES.COST).toString(),
          projectId: project.id,
          costType: isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
          costName: evaluatorName ?? monitor?.name ?? checkType,
          referenceType: CostReferenceType.CHECK,
          referenceId: evaluatorName ?? monitor?.id ?? checkType,
          amount: result.cost.amount,
          currency: result.cost.currency,
          extraInfo: { trace_id: params.trace_id },
        },
      });
      costId = cost.id;
    }
  } catch (error) {
    captureException(toError(error), { extra: { projectId: project.id } });
    logger.error({ err: error, projectId: project.id }, "error running evaluation");
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Internal error",
      traceback: [],
    };
  } finally {
    await c.app.evaluations
      .reportEvaluation({
        tenantId: project.id,
        evaluationId,
        evaluatorId,
        evaluatorType: checkType!,
        evaluatorName: evaluatorName ?? monitor?.name ?? params.name ?? undefined,
        traceId: params.trace_id ?? undefined,
        isGuardrail: isGuardrail ?? undefined,
        status: result!.status,
        // The custom-evaluator error path spreads the raw evaluator result
        // (`{ ...result, status: "error" }`), so `"score" in result` is NOT
        // protective here — gate on status instead (#6833).
        ...gatedVerdictFields(result!),
        details: "details" in result! ? result!.details : undefined,
        costId: costId ?? null,
        occurredAt: Date.now(),
        error:
          result!.status === "error"
            ? "details" in result!
              ? result!.details
              : undefined
            : undefined,
      })
      .catch((eventError: unknown) => {
        captureException(toError(eventError), {
          extra: {
            projectId: project.id,
            evaluationId,
            event: "reported",
          },
        });
        logger.error(
          { err: eventError, projectId: project.id, evaluationId },
          "Failed to emit evaluation reported event",
        );
      });
  }

  const resultWithoutTraceback: EvaluationRESTResult =
    result!.status === "error"
      ? {
          status: "error",
          error_type: "EVALUATOR_ERROR",
          details: result!.details,
          ...(isGuardrail ? { passed: true } : {}),
        }
      : result!.status === "skipped"
        ? {
            status: "skipped",
            details: result!.details,
            // An evaluation that declines to score can still have spent
            // money: the comparison judge pays for both of its passes before
            // finding they disagree. Only the fields named here leave the
            // boundary, so the cost is carried across explicitly.
            ...(result!.cost ? { cost: result!.cost } : {}),
            ...(isGuardrail ? { passed: true } : {}),
          }
        : {
            ...result!,
            ...(isGuardrail ? { passed: result!.passed ?? true } : {}),
          };

  markUsed();
  return c.json(resultWithoutTraceback);
}

// --- Batch evaluation processing ---

const VALID_TARGET_TYPES: ESBatchEvaluationTargetType[] = ["prompt", "agent", "custom"];

const processTargets = (
  targets: ESBatchEvaluationRESTParams["targets"],
): ESBatchEvaluationTarget[] | null => {
  if (!targets || targets.length === 0) return null;

  return targets.map((target) => {
    let targetType: ESBatchEvaluationTargetType = target.type ?? "custom";
    let metadata = target.metadata;

    if (metadata && "type" in metadata) {
      const typeFromMetadata = metadata.type;
      if (typeof typeFromMetadata === "string") {
        const parseResult = eSBatchEvaluationTargetTypeSchema.safeParse(typeFromMetadata);
        if (parseResult.success) {
          targetType = parseResult.data;
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
  app: Pick<RequestAppServices, "evaluations" | "experiments">,
  project: Project,
  param: ESBatchEvaluationRESTParams,
): Promise<void> => {
  const { experiment_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment({
    experiments: app.experiments,
    project,
    experiment_id,
    experiment_slug,
    experiment_type: ExperimentType.BATCH_EVALUATION_V2,
    experiment_name: param.name ?? undefined,
    workflowId: param.workflow_id ?? undefined,
  });

  const processedTargets = processTargets(param.targets);

  const batchEvaluation: ESBatchEvaluation = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    targets: processedTargets,
    dataset: param.dataset ?? [],
    evaluations: param.evaluations ?? [],
    timestamps: {
      ...param.timestamps,
      created_at: param.timestamps?.created_at ?? new Date().getTime(),
      inserted_at: new Date().getTime(),
      updated_at: new Date().getTime(),
    },
  };

  eSBatchEvaluationSchema.parse(batchEvaluation);

  await dispatchToClickHouse(app, project, experiment.id, batchEvaluation);
};

const dispatchToClickHouse = async (
  app: Pick<RequestAppServices, "evaluations" | "experiments">,
  project: Project,
  experimentId: string,
  batchEvaluation: ESBatchEvaluation,
): Promise<void> => {
  const { run_id: runId } = batchEvaluation;
  const targets = mapLegacyExperimentTargets(batchEvaluation.targets ?? []);

  try {
    await app.experiments.startExperimentRun({
      tenantId: project.id,
      runId,
      experimentId,
      total: batchEvaluation.total || batchEvaluation.dataset.length,
      targets,
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error(
      { error, runId, projectId: project.id },
      "Failed to dispatch startExperimentRun to CH",
    );
    throw error;
  }

  const resultPromises = [
    ...batchEvaluation.dataset.map((entry) =>
      app.experiments
        .recordTargetResult({
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
          targets,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            {
              err,
              runId,
              index: entry.index,
              targetId: entry.target_id,
            },
            "Failed to dispatch recordTargetResult to CH",
          );
        }),
    ),
    ...batchEvaluation.evaluations.map((evaluation) =>
      app.experiments
        .recordEvaluatorResult({
          tenantId: project.id,
          runId,
          experimentId,
          index: evaluation.index,
          targetId: evaluation.target_id ?? "",
          evaluatorId: evaluation.evaluator,
          evaluatorName: evaluation.name ?? undefined,
          status: evaluation.status,
          score: typeof evaluation.score === "number" ? evaluation.score : undefined,
          label: evaluation.label ?? undefined,
          passed: evaluation.passed ?? undefined,
          details: evaluation.details ?? undefined,
          cost: evaluation.cost ?? undefined,
          inputs: evaluation.inputs ?? undefined,
          duration: typeof evaluation.duration === "number" ? evaluation.duration : undefined,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            {
              err,
              runId,
              index: evaluation.index,
              evaluator: evaluation.evaluator,
            },
            "Failed to dispatch recordEvaluatorResult to CH",
          );
        }),
    ),
  ];
  await Promise.all(resultPromises);

  if (batchEvaluation.timestamps.finished_at || batchEvaluation.timestamps.stopped_at) {
    try {
      await app.experiments.completeExperimentRun({
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

  {
    const evalPromises = batchEvaluation.evaluations.map((evaluation) => {
      const targetId = evaluation.target_id ?? "";
      const evaluationId = `local_eval_${runId}_${evaluation.evaluator}_${evaluation.index}_${targetId}`;
      return app.evaluations
        .reportEvaluation({
          tenantId: project.id,
          evaluationId,
          evaluatorId: evaluation.evaluator,
          evaluatorType: evaluation.evaluator,
          evaluatorName: evaluation.name ?? undefined,
          status: evaluation.status,
          ...gatedVerdictFields(evaluation),
          details: evaluation.details ?? undefined,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            { err, evaluationId, evaluator: evaluation.evaluator },
            "Failed to dispatch evaluation to evaluation processing pipeline",
          );
        });
    });
    await Promise.all(evalPromises);
  }
};
