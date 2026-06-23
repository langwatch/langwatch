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
import { zValidator } from "@hono/zod-validator";
import { ExperimentType } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import {
  createInitialUIState,
  type EvaluationsV3State,
} from "~/experiments-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/experiments-v3/types/persistence";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { Permission } from "~/server/api/rbac";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { abortManager } from "~/server/experiments-v3/execution/abortManager";
import { loadExecutionData } from "~/server/experiments-v3/execution/dataLoader";
import {
  requestAbort,
  runOrchestrator,
} from "~/server/experiments-v3/execution/orchestrator";
import { runStateManager } from "~/server/experiments-v3/execution/runStateManager";
import {
  type EvaluationV3Event,
  executionRequestSchema,
} from "~/server/experiments-v3/execution/types";
import { ExperimentRunService } from "~/server/experiments-v3/services/experiment-run.service";
import { trackServerEvent } from "~/server/posthog";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { fireExperimentRanNurturing } from "../../../ee/billing/nurturing/hooks/featureAdoption";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:experiments-v3");

const secured = createServiceApp({ basePath: "/api/experiments" });
const sessionAuth = handlerManagedAuth(
  "user session validated in-handler via getServerAuthSession",
);
const apiKeyAuth = handlerManagedAuth(
  "project API key resolved in-handler via TokenResolver + enforceApiKeyCeiling",
);

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
    return { error: denial.message, status: denial.status };
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

const getRunUrl = (
  projectSlug: string,
  experimentSlug: string,
  runId: string,
) => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.langwatch.ai";
  return `${baseUrl}/${projectSlug}/experiments/${experimentSlug}?runId=${runId}`;
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
      datasetRowIds,
      loadedPrompts,
      loadedAgents,
      loadedEvaluators,
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
          datasetRowIds,
          loadedPrompts,
          loadedAgents,
          loadedEvaluators,
          concurrency: request.concurrency,
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

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: (error as Error).message,
          }),
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
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  logger.info({ projectId, runId }, "Requesting abort");
  await requestAbort(runId);
  // Also signal via abortManager (the standalone abort route used this)
  await abortManager.requestAbort(runId);

  return c.json({ success: true, runId, message: "Abort requested" });
});

// ── POST /:slug/run  (CI/CD execution) ──────────────────────────────

secured.access(apiKeyAuth).post("/:slug/run", async (c) => {
  const { slug } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:manage");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project, markUsed } = authResult;

  const experiment = await ExperimentService.create(prisma).findBySlugAndType({
    projectId: project.id,
    slug,
    type: ExperimentType.EVALUATIONS_V3,
  });

  if (!experiment) {
    return c.json({ error: "Experiment not found" }, { status: 404 });
  }

  const parseResult = persistedEvaluationsV3StateSchema.safeParse(
    experiment.workbenchState,
  );
  if (!parseResult.success) {
    logger.error(
      { slug, errors: parseResult.error.errors },
      "Invalid workbenchState",
    );
    return c.json(
      { error: "Invalid experiment configuration" },
      { status: 400 },
    );
  }

  const workbenchState = parseResult.data;
  const dataset = workbenchState.datasets[0];
  if (!dataset) {
    return c.json({ error: "No dataset configured" }, { status: 400 });
  }

  const dataResult = await loadExecutionData(
    project.id,
    dataset,
    workbenchState.targets,
    workbenchState.evaluators,
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
    datasetRowIds,
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
  } = dataResult;

  const state = buildState(workbenchState);

  const acceptHeader = c.req.header("Accept") ?? "";
  const isSSE = acceptHeader.includes("text/event-stream");

  logger.info(
    { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
    "Starting CI/CD experiment execution",
  );

  const totalCells = datasetRows.length * workbenchState.targets.length;

  markUsed();

  if (isSSE) {
    return streamSSE(c, async (stream) => {
      try {
        const orchestrator = runOrchestrator({
          projectId: project.id,
          experimentId: experiment.id,
          scope: { type: "full" },
          state,
          datasetRows,
          datasetColumns,
          datasetRowIds,
          loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
          loadedAgents: loadedAgents as Map<string, TypedAgent>,
          loadedEvaluators,
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

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: (error as Error).message,
          }),
        });
      }
    });
  }

  // Polling mode
  const runExecution = async (runId: string) => {
    try {
      const orchestrator = runOrchestrator({
        projectId: project.id,
        experimentId: experiment.id,
        scope: { type: "full" },
        state,
        datasetRows,
        datasetColumns,
        datasetRowIds,
        loadedPrompts: loadedPrompts as Map<string, VersionedPrompt>,
        loadedAgents: loadedAgents as Map<string, TypedAgent>,
        loadedEvaluators,
        runId,
      });

      for await (const event of orchestrator) {
        await runStateManager.addEvent(runId, event as EvaluationV3Event);

        if (event.type === "done") {
          const summary = {
            ...event.summary,
            runUrl: getRunUrl(project.slug, slug, runId),
          };
          await runStateManager.completeRun(runId, summary);
          break;
        }

        if (event.type === "stopped") {
          await runStateManager.stopRun(runId);
          break;
        }
      }
    } catch (error) {
      logger.error(
        { error, projectId: project.id, slug, runId },
        "Execution error",
      );
      captureException(toError(error), {
        extra: { projectId: project.id, slug, runId },
      });
      await runStateManager.failRun(runId, (error as Error).message);
    }
  };

  const runId = generateHumanReadableId();

  await runStateManager.createRun({
    runId,
    projectId: project.id,
    experimentId: experiment.id,
    experimentSlug: slug,
    total: totalCells,
  });

  void runExecution(runId);

  return c.json({
    runId,
    status: "running",
    total: totalCells,
    runUrl: getRunUrl(project.slug, slug, runId),
  });
});

// ── GET /runs?experimentSlug=... (list runs for an experiment) ──────

secured.access(apiKeyAuth).get("/runs", async (c) => {
  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
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
    return c.json({ error: "Experiment not found" }, { status: 404 });
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

secured.access(apiKeyAuth).get("/runs/:runId", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project, markUsed } = authResult;

  const runState = await runStateManager.getRunState(runId);

  if (!runState) {
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  if (runState.projectId !== project.id) {
    return c.json({ error: "Run not found" }, { status: 404 });
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
      return c.json({ error: "Run not found" }, { status: 404 });
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
      error: runState.error,
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
secured.access(apiKeyAuth).get("/runs/:runId/results", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
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
    return c.json(
      {
        error:
          "Run not found. Pass ?experimentSlug=<slug> if the run is older than 24h.",
      },
      { status: 404 },
    );
  }

  try {
    const experimentRunService = ExperimentRunService.create(prisma);
    const run = await experimentRunService.getRun({
      projectId: project.id,
      experimentId,
      runId,
    });

    if (!run) {
      return c.json(
        { error: "Run not found or results not yet available" },
        { status: 404 },
      );
    }

    markUsed();
    return c.json(run);
  } catch (error) {
    logger.error({ error, runId }, "Failed to fetch run results");
    return c.json(
      { error: "Run not found or results not yet available" },
      { status: 404 },
    );
  }
});

export const app = secured.hono;
