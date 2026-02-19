import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { handle } from "hono/vercel";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import {
  createInitialUIState,
  type EvaluationsV3State,
} from "~/evaluations-v3/types";
import { hasProjectPermission } from "~/server/api/rbac";
import { authOptions } from "~/server/auth";
import { prisma } from "~/server/db";
import { loadExecutionData } from "~/server/evaluations-v3/execution/dataLoader";
import {
  requestAbort,
  runOrchestrator,
} from "~/server/evaluations-v3/execution/orchestrator";
import { executionRequestSchema } from "~/server/evaluations-v3/execution/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:evaluations-v3:execute");

const app = new Hono().basePath("/api/evaluations/v3");
app.use(tracerMiddleware({ name: "evaluations-v3-execute" }));
app.use(loggerMiddleware());

/**
 * Execute an evaluation run.
 * Streams SSE events back to the client as execution progresses.
 */
app.post("/execute", zValidator("json", executionRequestSchema), async (c) => {
  const request = await c.req.json();
  const { projectId } = request;

  logger.info(
    { projectId, scope: request.scope },
    "Starting evaluation execution",
  );

  // Authenticate
  const session = await getServerSession(authOptions(c.req.raw as NextRequest));
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  // Authorize - use new RBAC system with evaluations:manage permission
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

  // Load all execution data using shared loader
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

  // Build state object from request
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

  // Fetch project feature flag for event sourcing routing
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { featureEventSourcingEvaluationIngestion: true },
  });

  // Stream SSE events
  return streamSSE(c, async (stream) => {
    try {
      // Only save to Elasticsearch for full runs (not single cell/row/target executions)
      const isFullRun = request.scope.type === "full";
      const shouldSaveToEs = !!request.experimentId && isFullRun;

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
        saveToEs: shouldSaveToEs,
        concurrency: request.concurrency,
        featureEventSourcingEvaluationIngestion: project?.featureEventSourcingEvaluationIngestion ?? false,
      });

      for await (const event of orchestrator) {
        await stream.writeSSE({
          data: JSON.stringify(event),
        });

        // End stream on done or stopped
        if (event.type === "done" || event.type === "stopped") {
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

/**
 * Abort a running evaluation.
 */
app.post(
  "/abort",
  zValidator(
    "json",
    z.object({
      projectId: z.string(),
      runId: z.string(),
    }),
  ),
  async (c) => {
    const { projectId, runId } = await c.req.json();

    // Authenticate
    const session = await getServerSession(
      authOptions(c.req.raw as NextRequest),
    );
    if (!session) {
      return c.json(
        { error: "You must be logged in to access this endpoint." },
        { status: 401 },
      );
    }

    // Authorize - use new RBAC system with evaluations:manage permission
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

    return c.json({ success: true });
  },
);

export const GET = handle(app);
export const POST = handle(app);
