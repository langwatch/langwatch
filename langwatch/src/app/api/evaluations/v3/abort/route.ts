/**
 * POST /api/evaluations/v3/abort
 *
 * Requests abortion of a running evaluation.
 * Sets a Redis flag that the orchestrator checks between cell executions.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { hasProjectPermission } from "~/server/api/rbac";
import { authOptions } from "~/server/auth";
import { prisma } from "~/server/db";
import { abortManager } from "~/server/evaluations-v3/execution/abortManager";
import { createLogger } from "~/utils/logger";

const logger = createLogger("evaluations-v3:abort");

const abortRequestSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
});

export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = abortRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.errors },
        { status: 400 },
      );
    }

    const { projectId, runId } = parsed.data;

    // Authenticate
    const session = await getServerSession(authOptions(request));
    if (!session) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: "You do not have permission to access this endpoint." },
        { status: 403 },
      );
    }

    // Request abort - this sets the flag that the orchestrator checks
    await abortManager.requestAbort(runId);

    logger.info({ projectId, runId }, "Abort requested for evaluation run");

    return NextResponse.json({
      success: true,
      runId,
      message: "Abort requested",
    });
  } catch (error) {
    logger.error({ error }, "Failed to process abort request");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
