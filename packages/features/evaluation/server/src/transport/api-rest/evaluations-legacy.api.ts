/**
 * REST for the legacy evaluation endpoints: the evaluator catalogue, the batch
 * result log, the three evaluate doors and the dataset evaluation.
 *
 * Was `platform/app/src/server/routes/evaluations-legacy.ts`, which itself
 * replaced six `pages/api` handlers. The shape is unchanged — one handler
 * still serves all three evaluate paths over one envelope — and everything the
 * routes reached through the platform's global application container is a port
 * now, grouped by what a mount costs:
 *
 *   - the CATALOGUE needs nothing. `AVAILABLE_EVALUATORS` is compiled in, so
 *     the route is always registered.
 *   - the BATCH half needs the experiment run writer and the evaluation
 *     pipeline. A process holding both serves `POST /api/evaluations/batch/
 *     log_results`; one holding neither leaves it off rather than accepting
 *     rows it drops, because an SDK that got a 200 never resends them.
 *   - the RUN half needs the evaluator RUNTIME — the thing that actually calls
 *     langevals, a workflow or a model. A process without it leaves all four
 *     evaluate doors off: a door that authenticates, validates, and then fails
 *     at the last step is one an SDK retries forever.
 *
 * The refusal bodies are transcribed rather than rewritten. Every one of them
 * is what a deployed SDK shows a customer.
 */
import { handlerManagedAuth, publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, SecuredApp } from "@langwatch/api/rest";
import { mapZodIssuesToLogContext } from "@langwatch/config";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  AVAILABLE_EVALUATORS,
  CODE_EVALUATOR_CHECK_PREFIX,
  coerceEvaluatorScalar,
  type CustomEvaluatorDefinition,
  type EvaluationResult,
  evaluatorDisplayName,
  EvaluatorInvalidConfigError,
  type EvaluatorDefinition,
  EvaluatorNotFoundError,
  evaluatorsSchema,
  type EvaluatorTypes,
  EvaluatorWorkflowNotFoundError,
  getEvaluatorDefaultSettings,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { EvaluatorMissingFieldError } from "@langwatch/evaluation-contract";
import {
  type ESBatchEvaluation,
  type ESBatchEvaluationRESTParams,
  type ESBatchEvaluationTarget,
  type ESBatchEvaluationTargetType,
  eSBatchEvaluationRESTParamsSchema,
  eSBatchEvaluationSchema,
  eSBatchEvaluationTargetTypeSchema,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
  mapLegacyExperimentTargets,
  resolveDispatchEvaluatorType,
} from "@langwatch/experiment-contract";
import { rAGChunkSchema, extractChunkTextualContent } from "@langwatch/trace-contract";
import { getInputsOutputs, type StudioEdge, type StudioNode } from "@langwatch/workflow-contract";
import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute, resolver } from "hono-openapi";
import { nanoid } from "nanoid";
import { type ZodError, ZodError as ZodErrorClass, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { fromZodError } from "zod-validation-error";

import { bodyLimit } from "@langwatch/api/rest";
import {
  acknowledgementSchema,
  datasetEvaluateRequestSchema,
  evaluateErrorSchema,
  evaluateRequestSchema,
  evaluateResponseSchema,
  evaluationInputSchema,
  type EvaluationRESTParams,
  type EvaluationRESTResult,
  evaluatorCatalogueResponseSchema,
  legacySentenceErrorSchema,
  requestBodySchema,
} from "./evaluations-legacy.schemas";

/**
 * What the evaluator runtime is handed, as this family builds it.
 *
 * Two arms, because the two evaluator classes read their input differently: a
 * built-in evaluator takes the six canonical fields, and a custom or code
 * evaluator takes whatever its own graph declares.
 */
export type DataForEvaluation =
  | Readonly<{ type: "default"; data: Record<string, string | number | undefined | null> }>
  | Readonly<{ type: "custom"; data: Record<string, any> }>;

/** A resolved project credential, or the refusal this family publishes for it. */
export type EvaluationsLegacyCredential =
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/**
 * How this process turns a request into a project credential.
 *
 * The permission is not a parameter: every route on this family except the
 * catalogue asks for `evaluations:manage`, which is the over-coarse grain the
 * access declarations above record rather than quietly widen.
 */
export type EvaluationsLegacyCredentialPort = (input: {
  request: Request;
}) => Promise<EvaluationsLegacyCredential>;

/** The experiment run writer the batch log dispatches through. */
export interface EvaluationBatchExperimentPort {
  startExperimentRun(input: Record<string, unknown>): Promise<unknown>;
  recordTargetResult(input: Record<string, unknown>): Promise<unknown>;
  recordEvaluatorResult(input: Record<string, unknown>): Promise<unknown>;
  completeExperimentRun(input: Record<string, unknown>): Promise<unknown>;
}

/**
 * What `POST /api/evaluations/batch/log_results` needs from the process.
 *
 * The experiment lookup-or-create and the run writer travel together because
 * they are one write: the rows are addressed by the experiment the first half
 * resolves, and a process that could resolve one but not record against it
 * would answer 200 to rows nobody can read back.
 */
export interface EvaluationBatchRestPorts {
  findOrCreateExperiment(input: {
    projectId: string;
    experimentId?: string | undefined;
    experimentSlug?: string | undefined;
    experimentType: "BATCH_EVALUATION_V2";
    experimentName?: string | undefined;
    workflowId?: string | undefined;
  }): Promise<Readonly<{ id: string }>>;
  experiments(): EvaluationBatchExperimentPort;
  reportEvaluation(input: Record<string, unknown>): Promise<unknown>;
}

/** One saved or configured monitor, as the evaluate doors read it. */
export type EvaluationRunMonitor = Readonly<{
  id: string;
  name: string;
  checkType: string;
  parameters: unknown;
  enabled: boolean;
}>;

/** One custom evaluator, as the catalogue merge reads it. */
export type EvaluationRunCustomEvaluator = Readonly<{
  id: string;
  name: string;
  versions: ReadonlyArray<Readonly<{ dsl?: unknown }>>;
}>;

/**
 * What the four evaluate doors need from the process.
 *
 * `runEvaluation` is the one that decides whether they are mounted at all: it
 * is the evaluator RUNTIME — the model gateway, the managed providers, the
 * workflow service and the evaluator service behind one call — and a process
 * that cannot run an evaluator has nothing to answer these paths with.
 */
export interface EvaluationRunRestPorts {
  /** Runs one evaluator over one input, and never rejects for a domain reason. */
  runEvaluation(input: {
    projectId: string;
    evaluatorType: EvaluatorTypes;
    data: DataForEvaluation;
    settings: Record<string, unknown>;
  }): Promise<SingleEvaluationResult>;
  /** The saved-evaluator directory the `evaluators/{slug|id}` form resolves on. */
  evaluators(): Readonly<{
    resolveForExecution(input: { idOrSlug: string; projectId: string }): Promise<
      Readonly<{
        checkType: string;
        settings: Record<string, unknown>;
        name: string;
        evaluatorId: string;
        requiredFields?: string[] | undefined;
      }>
    >;
  }>;
  /** One monitor by slug, or null. */
  tryGetMonitorBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<EvaluationRunMonitor | null>;
  /** One dataset by slug, or null. */
  tryGetDatasetBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<Readonly<{ id: string }> | null>;
  /** One experiment by slug, or null. */
  tryGetExperimentBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<Readonly<{ id: string }> | null>;
  /** The project's own custom evaluators, merged into the built-in catalogue. */
  listCustomEvaluators(input: {
    projectId: string;
  }): Promise<ReadonlyArray<EvaluationRunCustomEvaluator> | null | undefined>;
  /**
   * The model the project's cascade resolves for one feature key, or null.
   *
   * Null rather than a thrown "not configured": the caller's only response to
   * an unconfigured cascade is to fall back to the evaluator's own default, so
   * the distinction the exception carried has no consumer here.
   */
  resolveModelForFeature(input: { projectId: string; featureKey: string }): Promise<string | null>;
  /** Records what a run of an evaluator cost. */
  recordCost(input: {
    id: string;
    projectId: string;
    costType: "GUARDRAIL" | "TRACE_CHECK" | "BATCH_EVALUATION";
    costName: string;
    referenceType: "CHECK" | "BATCH";
    referenceId: string;
    amount: number;
    currency: string;
    extraInfo?: Record<string, unknown> | undefined;
  }): Promise<Readonly<{ id: string }>>;
  /** Records one row of a dataset evaluation. */
  recordBatchEvaluationRow(input: Record<string, unknown>): Promise<unknown>;
  /** Reports the verdict onto the evaluation processing pipeline. */
  reportEvaluation(input: Record<string, unknown>): Promise<unknown>;
  /**
   * The evaluator-id slug rule for an evaluation that names no evaluator.
   *
   * A port rather than this package's own `EvaluationNameAutoslugService`
   * call, so a process binds ONE instance of the rule for the collector, the
   * custom-evaluation sync and this door: the derived id IS the key.
   */
  deriveEvaluatorId(name: string): string;
  reportError?: ((error: Error, context: { projectId: string }) => void) | undefined;
}

/** The run half plus the credential every one of its doors resolves through. */
type EvaluationRunHandlerPorts = EvaluationRunRestPorts &
  Readonly<{ credential: EvaluationsLegacyCredentialPort }>;

export type EvaluationsLegacyRestPorts = Readonly<{
  credential: EvaluationsLegacyCredentialPort;
  /** The batch result log's collaborators, or none. */
  batch?: EvaluationBatchRestPorts | undefined;
  /** The evaluate doors' collaborators, or none. */
  evaluationRun?: EvaluationRunRestPorts | undefined;
  /** Records the wire size of a batch log body, where the process meters one. */
  observePayloadSize?: ((bytes: number) => void) | undefined;
  reportError?: ((error: Error, context: { projectId: string }) => void) | undefined;
}>;

/**
 * A `POST /api/dataset/evaluate` named an experiment slug this project holds
 * no experiment for.
 *
 * A handled 404 rather than the tRPC `NOT_FOUND` the platform route raised:
 * this is a REST door, its boundary serialises a handled error, and a tRPC
 * error reaching it rendered as an unrecognisable 500.
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

const logger = createLogger("langwatch:evaluations-legacy");

/**
 * Whatever was thrown, as an Error the process's report port can take.
 *
 * A thrown non-Error carries no stack, so the sink would record a bare string
 * with nothing to correlate it by; wrapping keeps every report the same shape.
 */
const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
const AUTH_REASON = "project API key resolved in-handler";

/**
 * The ksuid prefixes an evaluation and a cost row are minted with.
 *
 * STATED here rather than imported: the resource catalogue that names them is
 * a browser module, and a server package may not value-import one. Both are
 * persisted wire constants rather than decisions — changing either would key
 * new rows differently from every row already stored.
 */
const EVALUATION_KSUID_PREFIX = "eval";
const COST_KSUID_PREFIX = "cost";

/**
 * The model an evaluator falls back to when the project's cascade names none.
 *
 * Same reason as the ksuid prefixes: the constants module is a browser one.
 * `getEvaluatorDefaultSettings` keeps this as its last resort, which is what
 * the platform route passed it.
 */
const DEFAULT_MODEL = "openai/gpt-5";
const DEFAULT_EMBEDDINGS_MODEL = "openai/text-embedding-3-small";

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
 * The legacy evaluation family, built against one process's security.
 *
 * ORDERING inside the family is free: `/evaluations/list`,
 * `/evaluations/batch/log_results`, the two `/evaluations/:evaluator`
 * shapes, `/guardrails/:evaluator/evaluate` and `/dataset/evaluate` own
 * disjoint paths, and the two-segment evaluate form is distinguishable from
 * the one-segment form by arity rather than by registration order.
 */
export function createEvaluationsLegacyRestApp(options: {
  security: AppRestSecurity;
  ports: EvaluationsLegacyRestPorts;
}): SecuredApp<Env> {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

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

  // The batch result log, where this process composed the experiment run
  // writer and the evaluation pipeline it dispatches onto.
  const batch = ports.batch;
  if (batch) {
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
        const auth = await ports.credential({ request: c.req.raw });
        if (!auth.ok) {
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

        ports.observePayloadSize?.(payloadSize);

        let params: ESBatchEvaluationRESTParams;
        try {
          params = eSBatchEvaluationRESTParamsSchema.parse(body);
        } catch (error) {
          logger.error(
            { error, payloadSize, projectId: project.id },
            "invalid log_results data received",
          );
          ports.reportError?.(toError(error), { projectId: project.id });
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

        if (
          params.timestamps?.created_at &&
          params.timestamps.created_at.toString().length === 10
        ) {
          return c.json(
            {
              error:
                "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
            },
            400,
          );
        }

        try {
          await processBatchEvaluation(batch, project, params);
        } catch (error) {
          if (error instanceof z.ZodError) {
            logger.error(
              { error, runId: params.run_id, projectId: project.id },
              "failed to validate data for batch evaluation",
            );
            ports.reportError?.(toError(error), { projectId: project.id });
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
            ports.reportError?.(toError(error), { projectId: project.id });
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
  }

  // The four evaluate doors, where this process composed an evaluator
  // runtime. The credential travels with them because every one of them
  // resolves it inside the handler.
  const run: EvaluationRunHandlerPorts | undefined = ports.evaluationRun
    ? { ...ports.evaluationRun, credential: ports.credential }
    : undefined;
  if (run) {
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
        return handleEvaluatorCall(c, run, evaluatorSlug, false);
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
        return handleEvaluatorCall(c, run, evaluatorSlug, false);
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
        return handleEvaluatorCall(c, run, evaluatorSlug, true);
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
        const auth = await ports.credential({ request: c.req.raw });
        if (!auth.ok) {
          return c.json(auth.body, auth.status);
        }
        const { project, markUsed } = auth;

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
          ports.reportError?.(toError(error), { projectId: project.id });
          const validationError = fromZodError(error as ZodError);
          return c.json({ error: validationError.message }, 400);
        }

        const { datasetSlug } = params;
        const experimentSlug = params.experimentSlug ?? params.batchId ?? nanoid();
        const evaluation = params.evaluation;
        let settings = null;
        let checkType;

        const check = await run.tryGetMonitorBySlug({
          projectId: project.id,
          slug: evaluation,
        });

        if (check != null) {
          checkType = check.checkType;
          settings = check.parameters;
        } else {
          checkType = evaluation;
        }

        const evaluator = await getEvaluatorIncludingCustom(
          run,
          project.id,
          checkType as EvaluatorTypes,
        );
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
          ports.reportError?.(toError(error), { projectId: project.id });
          const validationError = fromZodError(error as ZodError);
          return c.json({ error: validationError.message }, 400);
        }

        const dataset = await run.tryGetDatasetBySlug({
          projectId: project.id,
          slug: datasetSlug,
        });
        if (!dataset) {
          return c.json({ error: "Dataset not found" }, 404);
        }

        let result: SingleEvaluationResult;
        try {
          result = await run.runEvaluation({
            projectId: project.id,
            data,
            evaluatorType: checkType as EvaluatorTypes,
            settings: (settings as Record<string, unknown>) ?? {},
          });
        } catch (error) {
          result = {
            status: "error",
            error_type: "INTERNAL_ERROR",
            details: error instanceof Error ? error.message : "Internal error",
            traceback: [],
          };
        }

        const experiment = await run.tryGetExperimentBySlug({
          projectId: project.id,
          slug: experimentSlug,
        });
        if (!experiment) {
          throw new EvaluationRestExperimentNotFoundError(experimentSlug);
        }

        if ("cost" in result && result.cost) {
          await run.recordCost({
            id: `cost_${nanoid()}`,
            projectId: project.id,
            costType: "BATCH_EVALUATION",
            costName: evaluation,
            referenceType: "BATCH",
            referenceId: experiment.id,
            amount: result.cost.amount,
            currency: result.cost.currency,
          });
        }

        const { score, passed, details, cost, status, label } = result as EvaluationResult;

        await run.recordBatchEvaluationRow({
          id: nanoid(),
          experimentId: experiment.id,
          projectId: project.id,
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

        markUsed();
        return c.json(result);
      },
    );
  }

  return secured;
}

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
  run: EvaluationRunRestPorts,
  projectId: string,
  checkType: EvaluatorTypes,
): Promise<
  EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS> | CustomEvaluatorDefinition | undefined
> => {
  const availableCustomEvaluators = await run.listCustomEvaluators({ projectId });

  const customEntries: [string, CustomEvaluatorDefinition][] = [];
  for (const evaluator of availableCustomEvaluators ?? []) {
    const dsl = evaluator.versions[0]?.dsl;
    if (!dsl) {
      continue;
    }
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
  run: EvaluationRunRestPorts,
  projectId: string,
): Promise<{ defaultModel: string | null; embeddingsModel: string | null }> => {
  const [defaultModel, embeddingsModel] = await Promise.all([
    run.resolveModelForFeature({ projectId, featureKey: "evaluator.create_default" }),
    run.resolveModelForFeature({
      projectId,
      featureKey: "analytics.topic_clustering_embeddings",
    }),
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

async function handleEvaluatorCall(
  c: Context,
  run: EvaluationRunHandlerPorts,
  evaluatorSlug: string,
  as_guardrail: boolean,
) {
  const auth = await run.credential({ request: c.req.raw });
  if (!auth.ok) {
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
      const resolved = await run.evaluators().resolveForExecution({
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
    const monitor = await run.tryGetMonitorBySlug({
      projectId: project.id,
      slug: evaluatorSlug,
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
    ? await run.tryGetMonitorBySlug({ projectId: project.id, slug: evaluatorSlug })
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
    (await getEvaluatorIncludingCustom(run, project.id, checkType as EvaluatorTypes));
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
    run.reportError?.(toError(error), { projectId: project.id });
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
            await resolveEvaluatorSettingsDefaults(run, project.id),
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
    run.reportError?.(toError(error), { projectId: project.id });
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
    run.reportError?.(toError(error), { projectId: project.id });
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

  const evaluationId = params.evaluation_id ?? generate(EVALUATION_KSUID_PREFIX).toString();
  const evaluatorId =
    savedEvaluatorId ??
    monitor?.id ??
    params.evaluator_id ??
    run.deriveEvaluatorId(params.name ?? checkType);

  const runEval = () =>
    run.runEvaluation({
      projectId: project.id,
      evaluatorType: checkType as EvaluatorTypes,
      data,
      settings,
    });

  try {
    result = await runEval();

    if (result.status === "error" && result.details.toLowerCase().includes("timed out")) {
      result = await runEval();
    }

    if ("cost" in result && result.cost) {
      const cost = await run.recordCost({
        id: generate(COST_KSUID_PREFIX).toString(),
        projectId: project.id,
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
    run.reportError?.(toError(error), { projectId: project.id });
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
    await run
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
        run.reportError?.(toError(eventError), { projectId: project.id });
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
  batch: EvaluationBatchRestPorts,
  /** Only the id is read; the credential resolves an identity, not a row. */
  project: Readonly<{ id: string }>,
  param: ESBatchEvaluationRESTParams,
): Promise<void> => {
  const { experiment_id, experiment_slug } = param;

  const experiment = await batch.findOrCreateExperiment({
    projectId: project.id,
    experimentId: experiment_id ?? undefined,
    experimentSlug: experiment_slug ?? undefined,
    experimentType: "BATCH_EVALUATION_V2",
    experimentName: param.name ?? undefined,
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

  await dispatchToClickHouse(batch, project, experiment.id, batchEvaluation);
};

const dispatchToClickHouse = async (
  batch: EvaluationBatchRestPorts,
  /** Only the id is read; the credential resolves an identity, not a row. */
  project: Readonly<{ id: string }>,
  experimentId: string,
  batchEvaluation: ESBatchEvaluation,
): Promise<void> => {
  const { run_id: runId } = batchEvaluation;
  const targets = mapLegacyExperimentTargets(batchEvaluation.targets ?? []);

  try {
    await batch.experiments().startExperimentRun({
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
      batch
        .experiments()
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
      batch
        .experiments()
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
      await batch.experiments().completeExperimentRun({
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
      return batch
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
