/**
 * Run Status Endpoint
 *
 * GET /api/evaluations/v3/runs/{runId}
 *
 * Returns the current status of an evaluation run for polling.
 * Authenticates via API key (X-Auth-Token or Authorization header).
 */

import { Hono } from "hono";
import { handle } from "hono/vercel";
import { prisma } from "~/server/db";
import { runStateManager } from "~/server/evaluations-v3/execution/runStateManager";
import { createLogger } from "~/utils/logger";
import { loggerMiddleware } from "~/app/api/middleware/logger";

const logger = createLogger("langwatch:evaluations-v3:runs");

const app = new Hono().basePath("/api/evaluations/v3/runs");
app.use(loggerMiddleware());

/**
 * Helper to authenticate via API key
 */
const authenticateApiKey = async (c: { req: { header: (name: string) => string | undefined } }) => {
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  if (!apiKey) {
    return { error: "Missing API key", status: 401 as const };
  }

  const project = await prisma.project.findUnique({
    where: { apiKey, archivedAt: null },
  });

  if (!project) {
    return { error: "Invalid API key", status: 401 as const };
  }

  return { project };
};

/**
 * Get run status for polling
 */
app.get("/:runId", async (c) => {
  const { runId } = c.req.param();

  // Authenticate
  const authResult = await authenticateApiKey(c);
  if ("error" in authResult) {
    return c.json({ error: authResult.error }, { status: authResult.status });
  }
  const { project } = authResult;

  // Get run state from Redis
  const runState = await runStateManager.getRunState(runId);

  if (!runState) {
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  // Verify run belongs to the authenticated project
  if (runState.projectId !== project.id) {
    return c.json({ error: "Run not found" }, { status: 404 });
  }

  logger.debug({ runId, status: runState.status }, "Run status queried");

  // Return status-appropriate response
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

export const GET = handle(app);
