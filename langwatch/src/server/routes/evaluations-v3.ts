/**
 * Hono routes for evaluations v3 endpoints.
 *
 * Consolidates:
 * - POST /api/evaluations/v3/execute (SSE streaming evaluation execution)
 * - POST /api/evaluations/v3/abort (abort a running evaluation)
 * - POST /api/evaluations/v3/:slug/run (CI/CD execution by slug)
 * - GET  /api/evaluations/v3/runs/:runId (poll run status)
 *
 * The execute and slug/run routes were already Hono apps in App Router;
 * the abort route was a raw NextRequest handler.
 * The runs/:runId route had its own Hono app.
 *
 * We import the existing Hono apps and merge them here.
 */
import { zValidator } from "@hono/zod-validator";
import { ExperimentType } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import type { Permission } from "~/server/api/rbac";
import {
  enforcePatCeiling,
  extractCredentials,
} from "~/server/pat/auth-middleware";
import { TokenResolver } from "~/server/pat/token-resolver";
import {
  createInitialUIState,
  type EvaluationsV3State,
} from "~/evaluations-v3/types";
import { persistedEvaluationsV3StateSchema } from "~/evaluations-v3/types/persistence";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { abortManager } from "~/server/evaluations-v3/execution/abortManager";
import { loadExecutionData } from "~/server/evaluations-v3/execution/dataLoader";
import {
  requestAbort,
  runOrchestrator,
} from "~/server/evaluations-v3/execution/orchestrator";
import { runStateManager } from "~/server/evaluations-v3/execution/runStateManager";
import { ExperimentRunService } from "~/server/evaluations-v3/services/experiment-run.service";
import {
  executionRequestSchema,
  type EvaluationV3Event,
} from "~/server/evaluations-v3/execution/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import { trackServerEvent } from "~/server/posthog";
import { fireExperimentRanNurturing } from "../../../ee/billing/nurturing/hooks/featureAdoption";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:evaluations-v3");

export const app = new Hono().basePath("/api/evaluations/v3");
app.use(tracerMiddleware({ name: "evaluations-v3" }));
app.use(loggerMiddleware());

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Authenticates a request via the unified PAT + legacy-key path and enforces
 * the given permission ceiling. Accepts any Hono-like context shape so this
 * helper remains testable.
 */
const authenticateRequest = async (
  c: { req: { header: (name: string) => string | undefined } },
  permission: Permission,
) => {
  const credentials = extractCredentials(c);
  if (!credentials) {
    return { error: "Missing credentials", status: 401 as const };
  }

  const resolved = await TokenResolver.create(prisma).resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    return { error: "Invalid credentials", status: 401 as const };
  }

  const denial = await enforcePatCeiling({ resolved, permission });
  if (denial) {
    return { error: denial.error, status: denial.status };
  }

  return { project: resolved.project };
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

app.post("/execute", zValidator("json", executionRequestSchema), async (c) => {
  const request = await c.req.json();
  const { projectId } = request;

  logger.info(
    { projectId, scope: request.scope },
    "Starting evaluation execution",
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
      captureException(error, { extra: { projectId } });

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

app.post("/abort", async (c) => {
  let body: { projectId?: string; runId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { projectId, runId } = body;
  if (!projectId || !runId) {
    return c.json(
      { error: "Invalid request body", details: "projectId and runId are required" },
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

  logger.info({ projectId, runId }, "Requesting abort");
  await requestAbort(runId);
  // Also signal via abortManager (the standalone abort route used this)
  await abortManager.requestAbort(runId);

  return c.json({ success: true, runId, message: "Abort requested" });
});

// ── POST /:slug/run  (CI/CD execution) ──────────────────────────────

app.post("/:slug/run", async (c) => {
  const { slug } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:manage");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project } = authResult;

  const experiment = await prisma.experiment.findFirst({
    where: {
      projectId: project.id,
      slug,
      type: ExperimentType.EVALUATIONS_V3,
    },
  });

  if (!experiment) {
    return c.json({ error: "Evaluation not found" }, { status: 404 });
  }

  const parseResult = persistedEvaluationsV3StateSchema.safeParse(
    experiment.workbenchState,
  );
  if (!parseResult.success) {
    logger.error(
      { slug, errors: parseResult.error.errors },
      "Invalid workbenchState",
    );
    return c.json({ error: "Invalid evaluation configuration" }, { status: 400 });
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
    loadedPrompts,
    loadedAgents,
    loadedEvaluators,
  } = dataResult;

  const state = buildState(workbenchState);

  const acceptHeader = c.req.header("Accept") ?? "";
  const isSSE = acceptHeader.includes("text/event-stream");

  logger.info(
    { projectId: project.id, slug, isSSE, rowCount: datasetRows.length },
    "Starting CI/CD evaluation execution",
  );

  const totalCells = datasetRows.length * workbenchState.targets.length;

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
        captureException(error, { extra: { projectId: project.id, slug } });

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
      captureException(error, {
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

// ── GET /runs/:runId (poll run status) ───────────────────────────────

app.get("/runs/:runId", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project } = authResult;

  const runState = await runStateManager.getRunState(runId);

  if (!runState) {
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  if (runState.projectId !== project.id) {
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  logger.debug({ runId, status: runState.status }, "Run status queried");

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
app.get("/runs/:runId/results", async (c) => {
  const { runId } = c.req.param();

  const authResult = await authenticateRequest(c, "evaluations:view");
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project } = authResult;

  // Look up experiment by slug or find the experiment that owns this runId
  const experimentSlug = c.req.query("experimentSlug");

  let experiment;
  if (experimentSlug) {
    experiment = await prisma.experiment.findFirst({
      where: { projectId: project.id, slug: experimentSlug },
    });
  }

  if (!experiment) {
    // Try to find experiment by scanning runs (fallback)
    experiment = await prisma.experiment.findFirst({
      where: { projectId: project.id },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!experiment) {
    return c.json({ error: "Experiment not found" }, { status: 404 });
  }

  try {
    const experimentRunService = ExperimentRunService.create(prisma);
    const run = await experimentRunService.getRun({
      projectId: project.id,
      experimentId: experiment.id,
      runId,
    });

    return c.json(run);
  } catch (error) {
    logger.error({ error, runId }, "Failed to fetch run results");
    return c.json(
      { error: "Run not found or results not yet available" },
      { status: 404 },
    );
  }
});
