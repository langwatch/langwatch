/**
 * Hono routes for experiment execution + run inspection.
 *
 * Consolidates:
 * - POST /api/experiments/execute (SSE streaming experiment execution)
 * - POST /api/experiments/abort (abort a running experiment)
 * - POST /api/experiments/:slug/run (CI/CD execution by slug)
 * - GET  /api/experiments/runs (list runs for an experiment slug)
 * - GET  /api/experiments/runs/:runId (poll run status)
 * - GET  /api/experiments/runs/:runId/results (per-row results)
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Experiment } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import type { Context } from "hono";
import { Hono } from "hono";
import type { SSEStreamingApi } from "hono/streaming";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import {
  createInitialUIState,
  type EvaluationsV3State,
} from "~/experiments-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/experiments-v3/types/persistence";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { Permission } from "~/server/api/rbac";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import {
  ExperimentNotFoundError,
  InvalidExperimentConfigurationError,
  RunNotFoundError,
} from "~/server/experiments/errors";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { abortManager } from "~/server/experiments-v3/execution/abortManager";
import type { LoadedExecutionData } from "~/server/experiments-v3/execution/dataLoader";
import { loadExecutionData } from "~/server/experiments-v3/execution/dataLoader";
import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import {
  requestAbort,
  runOrchestrator,
} from "~/server/experiments-v3/execution/orchestrator";
import { mapThrownErrorEvent } from "~/server/experiments-v3/execution/resultMapper";
import type { RunState } from "~/server/experiments-v3/execution/runStateManager";
import { runStateManager } from "~/server/experiments-v3/execution/runStateManager";
import {
  type EvaluationV3Event,
  type ExecutionScope,
  executionRequestSchema,
  runInputsBodySchema,
} from "~/server/experiments-v3/execution/types";
import { ExperimentRunService } from "~/server/experiments-v3/services/experiment-run.service";
import { trackServerEvent } from "~/server/posthog";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { fireExperimentRanNurturing } from "../../../ee/billing/nurturing/hooks/featureAdoption";
import {
  handledErrorEnvelopeSchema,
  listRunsResponseSchema,
  runResultsResponseSchema,
  runStatusResponseSchema,
  startRunResponseSchema,
} from "./experiments-v3.schemas";

const logger = createLogger("langwatch:experiments-v3");

/**
 * The errors these four routes answer with.
 *
 * Both come out flat, but by different routes. A 404 is a thrown
 * `HandledError` (`ExperimentNotFoundError`, `RunNotFoundError`) that the
 * boundary serialises, so it carries the code in `error` plus the error's
 * `meta` spread alongside it. A 401 is hand-rolled in the handler, which
 * forwards the handled denial payload when there is one and falls back to a
 * bare `{ error }` when there is not — the same open shape covers both.
 */
const experimentErrorResponses = {
  401: {
    description: "Missing or invalid API key, or the key lacks the permission",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
  404: {
    description: "No such experiment or run in this project",
    content: {
      "application/json": {
        schema: resolver(handledErrorEnvelopeSchema),
      },
    },
  },
};

const secured = createServiceApp({ basePath: "/api/experiments" });
const sessionAuth = handlerManagedAuth({
  reason: "user session validated in-handler via getServerAuthSession",
  permissions: ["evaluations:manage"],
  credential: "session",
});
// The read endpoints (runs list / status / results) and the run endpoint gate
// on different grains, so they declare separately: a single shared policy
// would report the coarser of the two for routes that only read.
const apiKeyAuthRead = handlerManagedAuth({
  reason:
    "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling",
  permissions: ["evaluations:view"],
  credential: "apiKey",
});
const apiKeyAuthRun = handlerManagedAuth({
  reason:
    "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling",
  permissions: ["evaluations:create"],
  credential: "apiKey",
});

// Backward-compat aliases: redirect old /api/evaluations/v3/... paths to new /api/experiments/...
// Python SDK still calls the old routes until it is updated in a follow-up.
export const legacyAliasApp = new Hono().basePath("/api/evaluations/v3");
legacyAliasApp.all("/*", (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(
    /^\/api\/evaluations\/v3/,
    "/api/experiments",
  );
  return app.fetch(new Request(url.toString(), c.req.raw));
});

// ── helpers ──────────────────────────────────────────────────────────

const tokenResolver = TokenResolver.create(prisma);

/**
 * Authenticates a request via the unified API-key + legacy-key path and enforces
 * the given permission ceiling. Accepts any Hono-like context shape so this
 * helper remains testable.
 *
 * Returns `markUsed` in the success case — a no-op for legacy keys, a
 * fire-and-forget lastUsedAt bump for API keys. Callers invoke it only after the
 * response has been built so `lastUsedAt` tracks fully-successful outcomes
 * (matches the route-owned pattern in `collector.ts`).
 */
const authenticateRequest = async (
  c: { req: { header: (name: string) => string | undefined } },
  permission: Permission,
) => {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) {
    return { error: "Missing credentials", status: 401 as const };
  }

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    return { error: "Invalid credentials", status: 401 as const };
  }

  try {
    await enforceApiKeyCeiling({ prisma, resolved, permission });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    // `body` carries the full handled payload (code, permission, tips) for
    // routes that answer with it; `error` stays the sentence for the ones that
    // still render `{ error }`.
    return {
      error: denial.message,
      status: denial.status,
      body: denial.body,
    };
  }

  const markUsed = () => {
    if (resolved.type === "apiKey") {
      tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
    }
  };

  return { project: resolved.project, resolved, markUsed };
};

/**
 * Wraps `authenticateRequest`'s open `{ error, status, body? }` failure shape
 * into a `{ response }` discriminant, so every route guards its auth result
 * the same single-`if` way `requireManagedSession` does.
 */
const requireApiKeyAuth = async (c: Context, permission: Permission) => {
  const authResult = await authenticateRequest(c, permission);
  if ("error" in authResult) {
    // `authResult.body` carries the handled payload (code, permission, tips)
    // when the denial came from a handled error; `{ error }` is the fallback
    // for the failures that have none.
    return {
      response: c.json(authResult.body ?? { error: authResult.error }, {
        status: authResult.status,
      }),
    };
  }
  return authResult;
};

const buildState = (
  workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>,
): EvaluationsV3State => {
  const dataset = workbenchState.datasets[0]!;
  return {
    name: workbenchState.name,
    datasets: workbenchState.datasets as EvaluationsV3State["datasets"],
    activeDatasetId: dataset.id ?? "dataset-1",
    targets: workbenchState.targets as EvaluationsV3State["targets"],
    evaluators: workbenchState.evaluators as EvaluationsV3State["evaluators"],
    results: {
      status: "running",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  };
};

/**
 * Session-based counterpart to `authenticateRequest`: validates the caller has
 * a browser session with `evaluations:manage` on `projectId`. Shared by
 * `/execute` and `/abort`, the two routes that authenticate this way rather
 * than via API key.
 */
const requireManagedSession = async (c: Context, projectId: string) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return {
      response: c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 as const },
      ),
    };
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:manage",
  );
  if (!hasPermission) {
    return {
      response: c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 as const },
      ),
    };
  }

  return { session };
};

/**
 * Runs `loadExecutionData` and shapes its `{ error, status }` failure into the
 * `c.json` response the two callers (`/execute`, `/:slug/run`) send back
 * as-is. Shared to keep the failure shape identical at both call sites.
 */
const loadExecutionDataOrResponse = async (
  c: Context,
  params: Parameters<typeof loadExecutionData>[0],
) => {
  const dataResult = await loadExecutionData(params);
  if ("error" in dataResult) {
    return {
      response: c.json(
        { error: dataResult.error },
        { status: dataResult.status as 400 | 404 },
      ),
    };
  }
  return { data: dataResult };
};

/**
 * Drains an orchestrator's event stream into SSE, invoking `onTerminalEvent`
 * once the run reaches `done`/`stopped`. Shared by `/execute` and the SSE
 * branch of `/:slug/run`; only `/execute` tracks completion, so the callback
 * is optional.
 */
const streamOrchestratorEvents = async ({
  orchestrator,
  stream,
  onTerminalEvent,
}: {
  orchestrator: AsyncGenerator<EvaluationV3Event>;
  stream: SSEStreamingApi;
  onTerminalEvent?: (event: EvaluationV3Event) => void;
}) => {
  for await (const event of orchestrator) {
    await stream.writeSSE({
      data: JSON.stringify(event),
    });

    if (event.type === "done" || event.type === "stopped") {
      onTerminalEvent?.(event);
      break;
    }
  }
};

/**
 * Writes the orchestrator's thrown-error event and logs/captures it. Shared by
 * `/execute` and the SSE branch of `/:slug/run` — the two places an
 * orchestrator can throw outside its own per-row error handling.
 *
 * Through the same mapper the orchestrator uses: a handled error travels as
 * its code plus `domainError` (so the client renders registry copy), and
 * anything else becomes a fixed generic string. Writing `(error as
 * Error).message` here put a Prisma string or a Go net error straight into
 * the customer's cell — these two frames were the only producers the
 * coded-error work didn't cover.
 *
 * No `rowIndex`: the orchestrator itself threw, so the whole run is gone and
 * the mapper says so, rather than blaming one row.
 */
const writeOrchestratorFailure = async ({
  stream,
  error,
  logContext,
}: {
  stream: SSEStreamingApi;
  error: unknown;
  logContext: Record<string, unknown>;
}) => {
  logger.error({ error, ...logContext }, "Orchestrator error");
  captureException(toError(error), { extra: logContext });

  await stream.writeSSE({
    data: JSON.stringify(mapThrownErrorEvent({ error })),
  });
};

const buildStateFromExecutionRequest = (
  request: z.infer<typeof executionRequestSchema>,
): EvaluationsV3State => ({
  name: request.name,
  datasets: [request.dataset],
  activeDatasetId: request.dataset.id ?? "dataset-1",
  targets: request.targets as EvaluationsV3State["targets"],
  evaluators: request.evaluators as EvaluationsV3State["evaluators"],
  results: {
    status: "running",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  },
  pendingSavedChanges: {},
  ui: createInitialUIState(),
});

/**
 * Fires the post-run analytics for `/execute`'s SSE loop once the orchestrator
 * reaches a terminal event: the `evaluation_ran` PostHog event, plus the
 * billing-nurturing hook for a full (not partial-row) run tied to a saved
 * experiment.
 */
const trackExperimentCompletion = ({
  session,
  projectId,
  experimentId,
  isFullRun,
}: {
  session: Awaited<ReturnType<typeof getServerAuthSession>>;
  projectId: string;
  experimentId?: string;
  isFullRun: boolean;
}) => {
  if (!session?.user?.id) return;
  trackServerEvent({
    userId: session.user.id,
    event: "evaluation_ran",
    projectId,
  });
  if (experimentId && isFullRun) {
    fireExperimentRanNurturing({
      userId: session.user.id,
      experimentId,
      projectId,
    });
  }
};

// ── POST /execute ────────────────────────────────────────────────────

secured.access(sessionAuth).post(
  "/execute",
  // Kept out of the published document. The route authenticates with a
  // browser session and streams workbench UI state, so an API-key caller
  // has no way to reach it; publishing it would document an endpoint that
  // answers 401 to everyone reading the reference. `zValidator` alone would
  // have emitted an operation here — the body schema is enough metadata for
  // the generator — so the exclusion has to be stated, not merely implied
  // by leaving `describeRoute` off.
  describeRoute({ hide: true }),
  zValidator("json", executionRequestSchema),
  async (c) => {
    const request = await c.req.json();
    const { projectId } = request;

    logger.info(
      { projectId, scope: request.scope },
      "Starting experiment execution",
    );

    const authResult = await requireManagedSession(c, projectId);
    if ("response" in authResult) return authResult.response;
    const { session } = authResult;

    const loadResult = await loadExecutionDataOrResponse(c, {
      projectId,
      dataset: request.dataset,
      targets: request.targets,
      evaluators: request.evaluators,
      inputs: {
        data: request.data,
        datasetId: request.dataset_id,
        parameters: request.parameters,
      },
    });
    if ("response" in loadResult) return loadResult.response;

    const {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = loadResult.data;

    const state = buildStateFromExecutionRequest(request);
    const isFullRun = request.scope.type === "full";

    return streamSSE(c, async (stream) => {
      try {
        const orchestrator = runOrchestrator({
          projectId,
          experimentId: request.experimentId,
          scope: request.scope,
          state,
          datasetRows,
          datasetColumns,
          loadedPrompts,
          loadedAgents,
          loadedEvaluators,
          loadedWorkflows,
          concurrency: request.concurrency,
          seedTargetOutputs: request.seedTargetOutputs,
        });

        await streamOrchestratorEvents({
          orchestrator,
          stream,
          onTerminalEvent: () =>
            trackExperimentCompletion({
              session,
              projectId,
              experimentId: request.experimentId,
              isFullRun,
            }),
        });
      } catch (error) {
        await writeOrchestratorFailure({
          stream,
          error,
          logContext: { projectId },
        });
      }
    });
  },
);

// ── POST /abort ──────────────────────────────────────────────────────

secured.access(sessionAuth).post("/abort", async (c) => {
  let body: { projectId?: string; runId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { projectId, runId } = body;
  if (!projectId || !runId) {
    return c.json(
      {
        error: "Invalid request body",
        details: "projectId and runId are required",
      },
      { status: 400 },
    );
  }

  const authResult = await requireManagedSession(c, projectId);
  if ("response" in authResult) return authResult.response;

  // Ownership check: holding evaluations:manage on `projectId` does NOT grant
  // the right to abort a run that belongs to a different project. The runId is
  // attacker-controlled, so verify the run is owned by the authenticated
  // project before signaling an abort. Without this, a user could abort another
  // tenant's experiment run by guessing its runId.
  //
  // In-flight runs register their owner via abortManager.setRunning, which
  // covers the interactive workbench SSE path — that path streams results
  // directly and never creates a polling run-state record, so consulting only
  // runStateManager would 404 every workbench abort. runStateManager remains
  // the fallback for the CI/CD polling path.
  const ownerProjectId =
    (await abortManager.getRunningProjectId(runId)) ??
    (await runStateManager.getRunState(runId))?.projectId;
  if (!ownerProjectId || ownerProjectId !== projectId) {
    throw new RunNotFoundError(runId);
  }

  logger.info({ projectId, runId }, "Requesting abort");
  await requestAbort(runId);
  // Also signal via abortManager (the standalone abort route used this)
  await abortManager.requestAbort(runId);

  return c.json({ success: true, runId, message: "Abort requested" });
});

/**
 * Loads the experiment backing `/:slug/run`, its parsed workbench state, and
 * its configured dataset. The experiment-not-found and invalid-workbenchState
 * failures are ours, not the caller's, so both throw rather than return a
 * response — the boundary renders the HandledError. A missing dataset is the
 * caller's (an experiment saved without one), so that one comes back as a
 * `{ response }` for the route to return as-is.
 */
const resolveRunnableExperiment = async (
  c: Context,
  {
    projectId,
    slug,
  }: {
    projectId: string;
    slug: string;
  },
): Promise<
  | { response: Response }
  | {
      experiment: Experiment;
      workbenchState: z.infer<typeof persistedEvaluationsV3StateSchema>;
      dataset: NonNullable<
        z.infer<typeof persistedEvaluationsV3StateSchema>["datasets"][number]
      >;
    }
> => {
  const experiment = await ExperimentService.create(prisma).findBySlugAndType({
    projectId,
    slug,
    type: ExperimentType.EVALUATIONS_V3,
  });

  if (!experiment) {
    throw new ExperimentNotFoundError(slug);
  }

  const parseResult = persistedEvaluationsV3StateSchema.safeParse(
    experiment.workbenchState,
  );
  if (!parseResult.success) {
    logger.error(
      { slug, errors: parseResult.error.errors },
      "Invalid workbenchState",
    );
    // The stored workbench state no longer matches its schema. The customer
    // did not type this and cannot repair it from the API, so it is ours:
    // `fault: "platform"` keeps it out of the customer-error noise.
    throw new InvalidExperimentConfigurationError(slug);
  }

  const workbenchState = parseResult.data;
  const dataset = workbenchState.datasets[0];
  if (!dataset) {
    return {
      response: c.json({ error: "No dataset configured" }, { status: 400 }),
    };
  }

  return { experiment, workbenchState, dataset };
};

/**
 * Parses `/:slug/run`'s optional JSON body. An empty body is allowed (runs
 * the experiment's full saved dataset); malformed JSON or a body that fails
 * `runInputsBodySchema` answers 400 rather than silently defaulting to a full
 * run on invalid input.
 */
const parseRunInputsBody = async (
  c: Context,
): Promise<
  { response: Response } | { runInputs: z.infer<typeof runInputsBodySchema> }
> => {
  const bodyText = await c.req.text();
  let rawBody: unknown = {};
  if (bodyText.trim()) {
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return {
        response: c.json({ error: "Invalid JSON body" }, { status: 400 }),
      };
    }
  }
  const inputsParse = runInputsBodySchema.safeParse(rawBody);
  if (!inputsParse.success) {
    return {
      response: c.json(
        {
          error: inputsParse.error.errors[0]?.message ?? "Invalid request body",
        },
        { status: 400 },
      ),
    };
  }
  return { runInputs: inputsParse.data };
};

/**
 * Assembles the shared param shape `runOrchestrator` and `startPollingRun`
 * both take for a `/:slug/run` execution — the two callers differ only in
 * whether they add `projectSlug`/`experimentSlug` (polling) or run it as an
 * SSE generator (streaming).
 */
const buildRunExecutionParams = ({
  project,
  experiment,
  scope,
  state,
  datasetRows,
  datasetColumns,
  loadedPrompts,
  loadedAgents,
  loadedEvaluators,
  loadedWorkflows,
}: {
  project: { id: string };
  experiment: { id: string };
  scope: ExecutionScope;
  state: EvaluationsV3State;
} & LoadedExecutionData) => ({
  projectId: project.id,
  experimentId: experiment.id,
  scope,
  state,
  datasetRows,
  datasetColumns,
  loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
  loadedAgents: loadedAgents as Map<string, TypedAgent>,
  loadedEvaluators,
  loadedWorkflows,
});

// ── POST /:slug/run  (CI/CD execution) ──────────────────────────────

secured.access(apiKeyAuthRun).post(
  "/:slug/run",
  describeRoute({
    summary: "Run an experiment",
    description:
      "Start a run of a saved experiment, addressed by slug. Returns a runId to poll straight away. Send `Accept: text/event-stream` instead to stream progress events until the run finishes.",
    tags: ["Experiments"],
    // Declared by hand rather than through zValidator: the handler reads the
    // raw body so it can accept an empty one, and parses with
    // `runInputsBodySchema` itself, so there is no validator schema for the
    // generator to read. Every field is optional — sending no body at all runs
    // the experiment's saved dataset as configured.
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { type: "object", additionalProperties: true },
                description:
                  "Rows to evaluate inline, instead of the experiment's saved dataset. Mutually exclusive with dataset_id.",
              },
              dataset_id: {
                type: "string",
                description:
                  "A saved dataset to evaluate, instead of the one the experiment is configured with. Mutually exclusive with data.",
              },
              parameters: {
                type: "object",
                additionalProperties: {
                  oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                  ],
                },
                description:
                  "Constant inputs applied to every row, overriding fields of the same name",
              },
              row_indices: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                description:
                  "Run only these rows of the dataset, by zero-based index",
              },
            },
            not: { required: ["data", "dataset_id"] },
          },
        },
      },
    },
    responses: {
      ...experimentErrorResponses,
      400: {
        description:
          "The body was not valid JSON, failed input validation, or the experiment has no dataset configured",
        content: {
          // These three refusals are hand-rolled in the handler and carry a
          // sentence in `error` rather than a stable code, so this documents
          // the shape as sent. Converting them to HandledError is the right
          // end state, but it turns `error` into a code slug and would break
          // any CI script matching the current text — worth its own change.
          "application/json": {
            schema: resolver(z.object({ error: z.string() })),
          },
        },
      },
      200: {
        description: "Run started",
        content: {
          "application/json": { schema: resolver(startRunResponseSchema) },
          "text/event-stream": {
            schema: {
              type: "string",
              description:
                "Progress events, ending with a done event carrying the summary",
            },
          },
        },
      },
    },
  }),
  async (c) => {
    const { slug } = c.req.param();

    // Starting a run CREATES a run row against an experiment that already
    // exists; it does not administer the evaluations family. Asking for
    // `:manage` here refused every least-privilege key that legitimately holds
    // the create — the Langy session key among them, which stops short of
    // `:manage` precisely because `:manage` implies the delete. `:manage` still
    // satisfies `:create` through `hasPermissionWithHierarchy`, so narrowing the
    // grain takes access away from nobody.
    const authResult = await requireApiKeyAuth(c, "evaluations:create");
    if ("response" in authResult) return authResult.response;
    const { project, markUsed } = authResult;

    const resolved = await resolveRunnableExperiment(c, {
      projectId: project.id,
      slug,
    });
    if ("response" in resolved) return resolved.response;
    const { experiment, workbenchState, dataset } = resolved;

    const bodyResult = await parseRunInputsBody(c);
    if ("response" in bodyResult) return bodyResult.response;
    const { runInputs } = bodyResult;

    const loadResult = await loadExecutionDataOrResponse(c, {
      projectId: project.id,
      dataset,
      targets: workbenchState.targets,
      evaluators: workbenchState.evaluators,
      inputs: {
        data: runInputs.data,
        datasetId: runInputs.dataset_id,
        parameters: runInputs.parameters,
      },
    });
    if ("response" in loadResult) return loadResult.response;

    const state = buildState(workbenchState);

    const scope: ExecutionScope = runInputs.row_indices
      ? { type: "rows", rowIndices: runInputs.row_indices }
      : { type: "full" };

    const acceptHeader = c.req.header("Accept") ?? "";
    const isSSE = acceptHeader.includes("text/event-stream");

    logger.info(
      {
        projectId: project.id,
        slug,
        isSSE,
        rowCount: loadResult.data.datasetRows.length,
      },
      "Starting CI/CD experiment execution",
    );

    markUsed();

    const executionParams = buildRunExecutionParams({
      project,
      experiment,
      scope,
      state,
      ...loadResult.data,
    });

    if (isSSE) {
      return streamSSE(c, async (stream) => {
        try {
          const orchestrator = runOrchestrator(executionParams);
          await streamOrchestratorEvents({ orchestrator, stream });
        } catch (error) {
          await writeOrchestratorFailure({
            stream,
            error,
            logContext: { projectId: project.id, slug },
          });
        }
      });
    }

    const { runId, runUrl, total } = await startPollingRun({
      ...executionParams,
      projectSlug: project.slug,
      experimentSlug: slug,
    });

    return c.json({ runId, status: "running", total, runUrl });
  },
);

// ── GET /runs?experimentSlug=... (list runs for an experiment) ──────

secured.access(apiKeyAuthRead).get(
  "/runs",
  describeRoute({
    summary: "List runs of an experiment",
    description:
      "Runs recorded for one experiment, newest first. Page through them with `page` and `pageSize`.",
    tags: ["Experiments"],
    parameters: [
      {
        in: "query",
        name: "experimentSlug",
        required: true,
        schema: { type: "string" },
        description: "Slug of the experiment whose runs you want",
      },
      {
        in: "query",
        name: "page",
        required: false,
        schema: { type: "integer", default: 1 },
        description: "1-based page number",
      },
      {
        in: "query",
        name: "pageSize",
        required: false,
        schema: { type: "integer", default: 50, maximum: 200 },
        description: "Runs per page, capped at 200",
      },
    ],
    responses: {
      ...experimentErrorResponses,
      400: {
        description: "experimentSlug was not supplied",
        content: {
          "application/json": {
            schema: resolver(z.object({ error: z.string() })),
          },
        },
      },
      200: {
        description: "Runs for the experiment",
        content: {
          "application/json": { schema: resolver(listRunsResponseSchema) },
        },
      },
    },
  }),
  async (c) => {
    const authResult = await requireApiKeyAuth(c, "evaluations:view");
    if ("response" in authResult) return authResult.response;
    const { project } = authResult;

    const experimentSlug = c.req.query("experimentSlug");
    if (!experimentSlug) {
      return c.json(
        {
          error: "experimentSlug query parameter is required",
        },
        { status: 400 },
      );
    }

    const pageSizeRaw = c.req.query("pageSize");
    const pageRaw = c.req.query("page");
    const pageSize = (() => {
      const parsed = pageSizeRaw ? parseInt(pageSizeRaw, 10) : 50;
      if (!Number.isFinite(parsed) || parsed <= 0) return 50;
      return Math.min(parsed, 200);
    })();
    const page = (() => {
      const parsed = pageRaw ? parseInt(pageRaw, 10) : 1;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })();

    const experimentRunService = ExperimentRunService.create(prisma);
    const { experiment, runs, totalHits } =
      await experimentRunService.listRunsForExperimentSlugPaginated({
        projectId: project.id,
        experimentSlug,
        page,
        pageSize,
      });

    if (!experiment) {
      throw new ExperimentNotFoundError(experimentSlug);
    }

    const offset = (page - 1) * pageSize;
    await authResult.markUsed?.();

    return c.json({
      experimentId: experiment.id,
      experimentSlug: experiment.slug,
      runs,
      pagination: {
        page,
        pageSize,
        totalHits,
        hasMore: offset + runs.length < totalHits,
      },
    });
  },
);

/**
 * Loads the run state for `/runs/:runId` and gates it behind three checks
 * that all raise the SAME code. From outside they are one answer — this run
 * is not yours to read — and telling a caller which of them it was would
 * confirm that the id exists in another project:
 *   1. no run state at all (expired or never existed)
 *   2. the run belongs to a different project
 *   3. the owning experiment was archived — a run must stop serving status
 *      from the Redis cache for the rest of its 24h TTL once that happens,
 *      or archive visibility would silently depend on run age
 */
const requireLiveRunOwnedByProject = async ({
  runId,
  projectId,
}: {
  runId: string;
  projectId: string;
}): Promise<RunState> => {
  const runState = await runStateManager.getRunState(runId);
  if (!runState) {
    throw new RunNotFoundError(runId);
  }

  if (runState.projectId !== projectId) {
    throw new RunNotFoundError(runId);
  }

  if (runState.experimentId) {
    const stillLive = await ExperimentService.create(prisma).isActive({
      projectId,
      id: runState.experimentId,
    });
    if (!stillLive) {
      throw new RunNotFoundError(runId);
    }
  }

  return runState;
};

/**
 * Shapes a `RunState` into `/runs/:runId`'s response body. `finishedAt` is
 * omitted while the run is still going; `completed` adds `summary`, `failed`
 * adds the error triple (code, optional domain payload, optional trace id),
 * and `stopped` (the implicit default) adds only `finishedAt`.
 */
const buildRunStatusResponse = (runState: RunState) => {
  const base = {
    runId: runState.runId,
    status: runState.status,
    progress: runState.progress,
    total: runState.total,
    startedAt: runState.startedAt,
  };

  if (runState.status === "running" || runState.status === "pending") {
    return base;
  }

  if (runState.status === "completed") {
    return {
      ...base,
      finishedAt: runState.finishedAt,
      summary: runState.summary,
    };
  }

  if (runState.status === "failed") {
    return {
      ...base,
      finishedAt: runState.finishedAt,
      // The code, never the thrown message — an API consumer gets the same
      // contract the stream gives a browser: something stable to branch on,
      // plus the handled payload when the failure had one, plus the trace id
      // for the failures we could not name (ADR-045).
      error: runState.error,
      ...(runState.domainError ? { domainError: runState.domainError } : {}),
      ...(runState.traceId ? { traceId: runState.traceId } : {}),
    };
  }

  // stopped
  return { ...base, finishedAt: runState.finishedAt };
};

// ── GET /runs/:runId (poll run status) ───────────────────────────────

secured.access(apiKeyAuthRead).get(
  "/runs/:runId",
  describeRoute({
    summary: "Poll a run",
    description:
      "Current state of one run. Returns progress while it is going and a summary once it finishes, so a CI job can poll this until `status` leaves `running`.",
    tags: ["Experiments"],
    responses: {
      ...experimentErrorResponses,
      200: {
        description: "Run state",
        content: {
          "application/json": { schema: resolver(runStatusResponseSchema) },
        },
      },
    },
  }),
  async (c) => {
    const { runId } = c.req.param();

    const authResult = await requireApiKeyAuth(c, "evaluations:view");
    if ("response" in authResult) return authResult.response;
    const { project, markUsed } = authResult;

    const runState = await requireLiveRunOwnedByProject({
      runId,
      projectId: project.id,
    });

    logger.debug({ runId, status: runState.status }, "Run status queried");
    markUsed();

    return c.json(buildRunStatusResponse(runState));
  },
);

/**
 * Resolves the experiment that owns a run for `/runs/:runId/results`.
 * ClickHouse storage is keyed on (TenantId, ExperimentId, RunId) — runId
 * alone is not unique across experiments (SDK callers can reuse a stable
 * run_id) — so the experimentId must be known before results can be queried.
 *
 * Two sources, tried in order:
 *   1. runStateManager (Redis, 24h TTL) — covers fresh runs.
 *   2. experimentSlug query param → prisma lookup — covers older runs whose
 *      run state has expired but whose ClickHouse rows remain.
 *
 * The previous "most recently updated experiment in the project" fallback
 * was unsafe: it returned cryptic 404s whenever the user had edited any other
 * experiment after the one that owned this run.
 */
const resolveResultsExperimentId = async ({
  c,
  runId,
  projectId,
}: {
  c: Context;
  runId: string;
  projectId: string;
}): Promise<string | undefined> => {
  const runState = await runStateManager.getRunState(runId);
  const slugFromState =
    runState && runState.projectId === projectId
      ? runState.experimentSlug
      : undefined;
  const experimentIdFromState =
    runState && runState.projectId === projectId
      ? runState.experimentId
      : undefined;

  const experimentSlug = c.req.query("experimentSlug") ?? slugFromState;
  let experimentId = experimentIdFromState;
  const experiments = ExperimentService.create(prisma);

  if (!experimentId && experimentSlug) {
    const experiment = await experiments.findIdBySlug({
      projectId,
      slug: experimentSlug,
    });
    experimentId = experiment?.id;
  } else if (experimentId) {
    // Independent of how we resolved the id, refuse to return results once
    // the owning experiment is archived. Without this check the Redis-state
    // path (fresh runs, within 24h TTL) would keep serving ClickHouse rows
    // after archive while the slug-based fallback already returns 404, so
    // archive visibility would silently depend on run age.
    const stillLive = await experiments.isActive({
      projectId,
      id: experimentId,
    });
    if (!stillLive) experimentId = undefined;
  }

  return experimentId;
};

/**
 * Fetches one run's results, or throws. Only a genuine miss is a 404 — this
 * used to answer EVERY failure with "Run not found or results not yet
 * available", so a ClickHouse outage told the caller their run did not
 * exist, a wrong answer served with a status code that invites them to stop
 * asking. Anything we cannot name goes up to the boundary, where it becomes a
 * 500 and a trace id (ADR-045).
 */
const fetchRunResultsOrThrow = async ({
  projectId,
  experimentId,
  runId,
}: {
  projectId: string;
  experimentId: string;
  runId: string;
}) => {
  try {
    const experimentRunService = ExperimentRunService.create(prisma);
    const run = await experimentRunService.getRun({
      projectId,
      experimentId,
      runId,
    });

    if (!run) {
      throw new RunNotFoundError(runId);
    }

    return run;
  } catch (error) {
    if (HandledError.isHandled(error)) throw error;
    logger.error({ error, runId }, "Failed to fetch run results");
    throw error;
  }
};

// ── GET /runs/:runId/results (full per-row results from ClickHouse) ──
secured.access(apiKeyAuthRead).get(
  "/runs/:runId/results",
  describeRoute({
    summary: "Read run results",
    description:
      "Every dataset row of a run with what the target predicted, plus one entry per evaluator per row. Runs older than the status cache need `experimentSlug` as well, since a run id is only unique within its experiment.",
    tags: ["Experiments"],
    parameters: [
      {
        in: "query",
        name: "experimentSlug",
        required: false,
        schema: { type: "string" },
        description:
          "Owning experiment. Required once the run has aged out of the status cache.",
      },
    ],
    responses: {
      ...experimentErrorResponses,
      200: {
        description: "Rows and evaluations for the run",
        content: {
          "application/json": { schema: resolver(runResultsResponseSchema) },
        },
      },
    },
  }),
  async (c) => {
    const { runId } = c.req.param();

    const authResult = await requireApiKeyAuth(c, "evaluations:view");
    if ("response" in authResult) return authResult.response;
    const { project, markUsed } = authResult;

    const experimentId = await resolveResultsExperimentId({
      c,
      runId,
      projectId: project.id,
    });
    if (!experimentId) {
      // The remediation that used to be spelled out here — pass ?experimentSlug
      // for a run older than the status cache — is the registry's copy for this
      // code now, so every surface says it the same way.
      throw new RunNotFoundError(runId);
    }

    const run = await fetchRunResultsOrThrow({
      projectId: project.id,
      experimentId,
      runId,
    });

    markUsed();
    return c.json(run);
  },
);

export const app = secured.hono;
