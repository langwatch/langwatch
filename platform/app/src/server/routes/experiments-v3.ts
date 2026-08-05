/**
 * Hono routes for experiment execution + run inspection.
 *
 * Consolidates:
 * - POST /api/experiments/execute (SSE streaming experiment execution)
 * - POST /api/experiments/abort (abort a running experiment)
 * - POST /api/experiments/:slug/run (CI/CD execution by slug)
 * - POST /api/experiments/:slug/comparison (attach a comparison judge by slug)
 * - GET  /api/experiments/runs (list runs for an experiment slug)
 * - GET  /api/experiments/runs/:runId (poll run status)
 * - GET  /api/experiments/runs/:runId/results (per-row results)
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { ExperimentType } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  createInitialUIState,
  type DatasetReference,
  type EvaluationsV3State,
  type TargetConfig,
} from "~/experiments-v3/types";
import {
  type PersistedEvaluationsV3State,
  persistedEvaluationsV3StateSchema,
} from "~/experiments-v3/types/persistence";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { Permission } from "~/server/api/rbac";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  validateJsonBody,
  validator as zValidator,
} from "~/server/api/validation";
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
import {
  attachComparison,
  attachComparisonBodySchema,
} from "~/server/experiments-v3/comparisonTargetService";
import { abortManager } from "~/server/experiments-v3/execution/abortManager";
import { loadExecutionData } from "~/server/experiments-v3/execution/dataLoader";
import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import {
  requestAbort,
  runOrchestrator,
} from "~/server/experiments-v3/execution/orchestrator";
import { mapThrownErrorEvent } from "~/server/experiments-v3/execution/resultMapper";
import { runStateManager } from "~/server/experiments-v3/execution/runStateManager";
import {
  type ExecutionScope,
  executionRequestSchema,
  runInputsBodySchema,
} from "~/server/experiments-v3/execution/types";
import { ExperimentRunService } from "~/server/experiments-v3/services/experiment-run.service";
import { trackServerEvent } from "~/server/posthog";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { fireExperimentRanNurturing } from "../../../ee/billing/nurturing/hooks/featureAdoption";

const logger = createLogger("langwatch:experiments-v3");

const secured = createServiceApp({ basePath: "/api/experiments" });
const sessionAuth = handlerManagedAuth({
  reason: "user session validated in-handler via getServerAuthSession",
  permissions: ["evaluations:manage"],
  credential: "session",
});
// The read endpoints (runs list / status / results) and the write endpoints
// gate on different grains, so they declare separately: a single shared policy
// would report the coarser of the two for routes that only read.
const apiKeyAuthRead = handlerManagedAuth({
  reason:
    "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling",
  permissions: ["evaluations:view"],
  credential: "apiKey",
});
// Every API-key-reachable write on this surface shares the create grain:
// starting a run creates a run, and attaching a comparison creates an
// evaluator and the target wiring for it. `:manage` is deliberately not
// reachable by an API key here. It implies the delete, no least-privilege key
// holds it (the Langy session key stops short of it on purpose), and
// `hasPermissionWithHierarchy` already lets a `:manage` holder satisfy
// `:create`, so asking for the narrower grain takes access away from nobody.
const apiKeyAuthWrite = handlerManagedAuth({
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

// ── POST /execute ────────────────────────────────────────────────────

secured
  .access(sessionAuth)
  .post("/execute", zValidator("json", executionRequestSchema), async (c) => {
    const request = await c.req.json();
    const { projectId } = request;

    logger.info(
      { projectId, scope: request.scope },
      "Starting experiment execution",
    );

    const session = await getServerAuthSession({ req: c.req.raw as any });
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 },
      );
    }

    const hasPermission = await hasProjectPermission(
      { prisma, session },
      projectId,
      "evaluations:manage",
    );
    if (!hasPermission) {
      return c.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 },
      );
    }

    const dataResult = await loadExecutionData(
      projectId,
      request.dataset,
      request.targets,
      request.evaluators,
      {
        data: request.data,
        datasetId: request.dataset_id,
        parameters: request.parameters,
      },
    );

    if ("error" in dataResult) {
      return c.json(
        { error: dataResult.error },
        { status: dataResult.status as 400 | 404 },
      );
    }

    const {
      datasetRows,
      datasetColumns,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
      loadedWorkflows,
    } = dataResult;

    const state: EvaluationsV3State = {
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
    };

    return streamSSE(c, async (stream) => {
      try {
        const isFullRun = request.scope.type === "full";

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

        for await (const event of orchestrator) {
          await stream.writeSSE({
            data: JSON.stringify(event),
          });

          if (event.type === "done" || event.type === "stopped") {
            if (session?.user?.id) {
              trackServerEvent({
                userId: session.user.id,
                event: "evaluation_ran",
                projectId,
              });
              if (request.experimentId && isFullRun) {
                fireExperimentRanNurturing({
                  userId: session.user.id,
                  experimentId: request.experimentId,
                  projectId,
                });
              }
            }
            break;
          }
        }
      } catch (error) {
        logger.error({ error, projectId }, "Orchestrator error");
        captureException(toError(error), { extra: { projectId } });

        // Through the same mapper the orchestrator uses: a handled error
        // travels as its code plus `domainError` (so the client renders
        // registry copy), and anything else becomes a fixed generic string.
        // Writing `(error as Error).message` here put a Prisma string or a Go
        // net error straight into the customer's cell — these two frames were
        // the only producers the coded-error work didn't cover.
        //
        // No `rowIndex`: the orchestrator itself threw, so the whole run is
        // gone and the mapper says so, rather than blaming one row.
        await stream.writeSSE({
          data: JSON.stringify(mapThrownErrorEvent({ error })),
        });
      }
    });
  });

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

  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "evaluations:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

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

// ── POST /:slug/run  (CI/CD execution) ──────────────────────────────

secured.access(apiKeyAuthWrite).post("/:slug/run", async (c) => {
  const { slug } = c.req.param();

  // Starting a run CREATES a run row against an experiment that already
  // exists; it does not administer the evaluations family. Asking for
  // `:manage` here refused every least-privilege key that legitimately holds
  // the create — the Langy session key among them, which stops short of
  // `:manage` precisely because `:manage` implies the delete. `:manage` still
  // satisfies `:create` through `hasPermissionWithHierarchy`, so narrowing the
  // grain takes access away from nobody.
  const authResult = await authenticateRequest(c, "evaluations:create");
  if ("error" in authResult) {
    // `authResult.body` carries the handled payload (code, permission, tips)
    // when the denial came from a handled error; `{ error }` is the fallback
    // for the failures that have none.
    return c.json(authResult.body ?? { error: authResult.error }, {
      status: authResult.status,
    });
  }
  const { project, markUsed } = authResult;

  const experiment = await ExperimentService.create(prisma).findBySlugAndType({
    projectId: project.id,
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
    return c.json({ error: "No dataset configured" }, { status: 400 });
  }

  // An empty body is allowed (a full run); malformed JSON must 400 rather than
  // silently default to {} and start a full run on invalid input.
  const bodyText = await c.req.text();
  let rawBody: unknown = {};
  if (bodyText.trim()) {
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return c.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  const inputsParse = runInputsBodySchema.safeParse(rawBody);
  if (!inputsParse.success) {
    return c.json(
      {
        error: inputsParse.error.errors[0]?.message ?? "Invalid request body",
      },
      { status: 400 },
    );
  }
  const runInputs = inputsParse.data;

  const dataResult = await loadExecutionData(
    project.id,
    dataset,
    workbenchState.targets,
    workbenchState.evaluators,
    {
      data: runInputs.data,
      datasetId: runInputs.dataset_id,
      parameters: runInputs.parameters,
    },
  );

  if ("error" in dataResult) {
    return c.json(
      { error: dataResult.error },
      { status: dataResult.status as 400 | 404 },
    );
  }

  const {
    datasetRows,
    datasetColumns,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
    loadedWorkflows,
  } = dataResult;

  const state = buildState(workbenchState);

  const scope: ExecutionScope = runInputs.row_indices
    ? { type: "rows", rowIndices: runInputs.row_indices }
    : { type: "full" };

  const acceptHeader = c.req.header("Accept") ?? "";
  const isSSE = acceptHeader.includes("text/event-stream");

  logger.info(
    { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
    "Starting CI/CD experiment execution",
  );

  markUsed();

  if (isSSE) {
    return streamSSE(c, async (stream) => {
      try {
        const orchestrator = runOrchestrator({
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

        for await (const event of orchestrator) {
          await stream.writeSSE({
            data: JSON.stringify(event),
          });

          if (event.type === "done" || event.type === "stopped") {
            break;
          }
        }
      } catch (error) {
        logger.error(
          { error, projectId: project.id, slug },
          "Orchestrator error",
        );
        captureException(toError(error), {
          extra: { projectId: project.id, slug },
        });

        // Through the same mapper the orchestrator uses: a handled error
        // travels as its code plus `domainError` (so the client renders
        // registry copy), and anything else becomes a fixed generic string.
        // Writing `(error as Error).message` here put a Prisma string or a Go
        // net error straight into the customer's cell — these two frames were
        // the only producers the coded-error work didn't cover.
        //
        // No `rowIndex`: the orchestrator itself threw, so the whole run is
        // gone and the mapper says so, rather than blaming one row.
        await stream.writeSSE({
          data: JSON.stringify(mapThrownErrorEvent({ error })),
        });
      }
    });
  }

  const { runId, runUrl, total } = await startPollingRun({
    projectId: project.id,
    projectSlug: project.slug,
    experimentId: experiment.id,
    experimentSlug: slug,
    scope,
    state,
    datasetRows,
    datasetColumns,
    loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
    loadedAgents: loadedAgents as Map<string, TypedAgent>,
    loadedEvaluators,
    loadedWorkflows,
  });

  return c.json({ runId, status: "running", total, runUrl });
});

// ── POST /:slug/comparison (attach a comparison target via API key) ─

secured.access(apiKeyAuthWrite).post("/:slug/comparison", async (c) => {
  const { slug } = c.req.param();

  // Authentication runs before the body is looked at, matching the sibling
  // run endpoint. Validating first would describe the request shape to a
  // caller who never proved they may see it.
  const authResult = await authenticateRequest(c, "evaluations:create");
  if ("error" in authResult) {
    return c.json(authResult.body ?? { error: authResult.error }, {
      status: authResult.status,
    });
  }
  const { project, markUsed } = authResult;

  const experimentService = ExperimentService.create(prisma);
  const experiment = await experimentService.findBySlugAndType({
    projectId: project.id,
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
    throw new InvalidExperimentConfigurationError(slug);
  }
  const workbenchState = parseResult.data;

  const body = await validateJsonBody({
    c,
    schema: attachComparisonBodySchema,
  });

  try {
    const { targets, comparisonTargetId, createdTargetIds, reusedTargetIds } =
      await attachComparison({
        prisma,
        projectId: project.id,
        targets: workbenchState.targets as TargetConfig[],
        datasets: workbenchState.datasets as DatasetReference[],
        activeDatasetId: workbenchState.activeDatasetId,
        body,
      });

    // `updatedAt` was read with the state above, so a Workbench autosave
    // landing in between refuses this write instead of being overwritten
    // by it.
    await experimentService.updateWorkbenchState({
      projectId: project.id,
      id: experiment.id,
      workbenchState: {
        ...workbenchState,
        // The DSL's `TargetConfig` and the persisted schema's inferred
        // target differ only in how loosely each types free-form JSON
        // (`json_schema`). The service re-parses the whole state before
        // writing, so the schema stays the authority on what lands.
        targets: targets as PersistedEvaluationsV3State["targets"],
      },
      expectedUpdatedAt: experiment.updatedAt,
    });

    logger.info(
      { projectId: project.id, slug, comparisonTargetId, createdTargetIds },
      "Attached comparison target via API key",
    );
    markUsed();

    return c.json({
      comparisonTargetId,
      createdTargetIds,
      reusedTargetIds,
      targets,
    });
  } catch (error) {
    // Handled errors already name their cause and carry the status the
    // boundary serialises; only the rest are ours to report.
    if (HandledError.isHandled(error)) {
      throw error;
    }
    logger.error(
      { error, projectId: project.id, slug },
      "Failed to attach comparison target",
    );
    captureException(toError(error), {
      extra: { projectId: project.id, slug },
    });
    throw error;
  }
});

// ── GET /runs?experimentSlug=... (list runs for an experiment) ──────

secured.access(apiKeyAuthRead).get("/runs", async (c) => {
  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    // `authResult.body` carries the handled payload (code, permission, tips)
    // when the denial came from a handled error; `{ error }` is the fallback
    // for the failures that have none.
    return c.json(authResult.body ?? { error: authResult.error }, {
      status: authResult.status,
    });
  }
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
});

// ── GET /runs/:runId (poll run status) ───────────────────────────────

secured.access(apiKeyAuthRead).get("/runs/:runId", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    // `authResult.body` carries the handled payload (code, permission, tips)
    // when the denial came from a handled error; `{ error }` is the fallback
    // for the failures that have none.
    return c.json(authResult.body ?? { error: authResult.error }, {
      status: authResult.status,
    });
  }
  const { project, markUsed } = authResult;

  const runState = await runStateManager.getRunState(runId);

  // All three not-found branches raise the SAME code. From outside they are one
  // answer — this run is not yours to read — and telling a caller which of them
  // it was would confirm that the id exists in another project.
  if (!runState) {
    throw new RunNotFoundError(runId);
  }

  if (runState.projectId !== project.id) {
    throw new RunNotFoundError(runId);
  }

  // Same archive guard as /runs/:runId/results: a run whose owning
  // experiment was archived must not keep serving status from the Redis
  // cache for the rest of the 24h TTL. Without this, archive visibility
  // silently depends on run age.
  if (runState.experimentId) {
    const stillLive = await ExperimentService.create(prisma).isActive({
      projectId: project.id,
      id: runState.experimentId,
    });
    if (!stillLive) {
      throw new RunNotFoundError(runId);
    }
  }

  logger.debug({ runId, status: runState.status }, "Run status queried");
  markUsed();

  if (runState.status === "running" || runState.status === "pending") {
    return c.json({
      runId: runState.runId,
      status: runState.status,
      progress: runState.progress,
      total: runState.total,
      startedAt: runState.startedAt,
    });
  }

  if (runState.status === "completed") {
    return c.json({
      runId: runState.runId,
      status: runState.status,
      progress: runState.progress,
      total: runState.total,
      startedAt: runState.startedAt,
      finishedAt: runState.finishedAt,
      summary: runState.summary,
    });
  }

  if (runState.status === "failed") {
    return c.json({
      runId: runState.runId,
      status: runState.status,
      progress: runState.progress,
      total: runState.total,
      startedAt: runState.startedAt,
      finishedAt: runState.finishedAt,
      // The code, never the thrown message — an API consumer gets the same
      // contract the stream gives a browser: something stable to branch on,
      // plus the handled payload when the failure had one, plus the trace id
      // for the failures we could not name (ADR-045).
      error: runState.error,
      ...(runState.domainError ? { domainError: runState.domainError } : {}),
      ...(runState.traceId ? { traceId: runState.traceId } : {}),
    });
  }

  // stopped
  return c.json({
    runId: runState.runId,
    status: runState.status,
    progress: runState.progress,
    total: runState.total,
    startedAt: runState.startedAt,
    finishedAt: runState.finishedAt,
  });
});

// ── GET /runs/:runId/results (full per-row results from ClickHouse) ──
secured.access(apiKeyAuthRead).get("/runs/:runId/results", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    // `authResult.body` carries the handled payload (code, permission, tips)
    // when the denial came from a handled error; `{ error }` is the fallback
    // for the failures that have none.
    return c.json(authResult.body ?? { error: authResult.error }, {
      status: authResult.status,
    });
  }
  const { project, markUsed } = authResult;

  // Resolve the owning experiment. ClickHouse storage is keyed on
  // (TenantId, ExperimentId, RunId) — runId alone is not unique across
  // experiments (SDK callers can reuse a stable run_id) — so we must know
  // the experimentId before we query results.
  //
  // Two sources, tried in order:
  //   1. runStateManager (Redis, 24h TTL) — covers fresh runs.
  //   2. experimentSlug query param → prisma lookup — covers older runs
  //      whose run state has expired but whose ClickHouse rows remain.
  //
  // The previous "most recently updated experiment in the project"
  // fallback was unsafe: it returned cryptic 404s whenever the user had
  // edited any other experiment after the one that owned this run.
  const runState = await runStateManager.getRunState(runId);
  const slugFromState =
    runState && runState.projectId === project.id
      ? runState.experimentSlug
      : undefined;
  const experimentIdFromState =
    runState && runState.projectId === project.id
      ? runState.experimentId
      : undefined;

  const experimentSlug = c.req.query("experimentSlug") ?? slugFromState;
  let experimentId = experimentIdFromState;
  const experiments = ExperimentService.create(prisma);

  if (!experimentId && experimentSlug) {
    const experiment = await experiments.findIdBySlug({
      projectId: project.id,
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
      projectId: project.id,
      id: experimentId,
    });
    if (!stillLive) experimentId = undefined;
  }

  if (!experimentId) {
    // The remediation that used to be spelled out here — pass ?experimentSlug
    // for a run older than the status cache — is the registry's copy for this
    // code now, so every surface says it the same way.
    throw new RunNotFoundError(runId);
  }

  try {
    const experimentRunService = ExperimentRunService.create(prisma);
    const run = await experimentRunService.getRun({
      projectId: project.id,
      experimentId,
      runId,
    });

    if (!run) {
      throw new RunNotFoundError(runId);
    }

    markUsed();
    return c.json(run);
  } catch (error) {
    // Only a genuine miss is a 404. This used to answer EVERY failure with
    // "Run not found or results not yet available", so a ClickHouse outage
    // told the caller their run did not exist — a wrong answer served with a
    // status code that invites them to stop asking. Anything we cannot name
    // goes up to the boundary, where it becomes a 500 and a trace id (ADR-045).
    if (HandledError.isHandled(error)) throw error;
    logger.error({ error, runId }, "Failed to fetch run results");
    throw error;
  }
});

export const app = secured.hono;
