/**
 * Hono app for trace export endpoints.
 *
 * POST /download — Streams exported trace data as CSV or JSONL.
 *
 * Progress events are broadcast via BroadcastService (Redis pub/sub)
 * so that tRPC subscriptions on any pod can relay them to the client.
 * This is the API layer: it handles HTTP concerns (auth, headers, streaming)
 * and delegates all domain logic to ExportService.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { NextRequest } from "~/types/next-stubs";
import crypto from "crypto";

import { handleError } from "../../../middleware/error-handler";
import { loggerMiddleware } from "../../../middleware/logger";
import { tracerMiddleware } from "../../../middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getUserProtectionsForProject } from "~/server/api/utils";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { ExportService } from "~/server/export/export.service";
import { exportRequestSchema } from "~/server/export/types";
import { getApp } from "~/server/app-layer/app";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:api:export-traces");

export const app = new Hono().basePath("/api/export/traces");

app.use(tracerMiddleware({ name: "export-traces" }));
app.use(loggerMiddleware());
app.onError(handleError);

/**
 * POST /download — Stream trace data as a file download.
 *
 * Authenticates via session, checks traces:view permission, then streams
 * CSV or JSONL data from ExportService's async generator directly to the
 * HTTP response. Sets Content-Disposition for browser file download.
 *
 * Broadcasts progress events via BroadcastService so any pod's tRPC
 * subscription can relay them to the client. The export ID is returned
 * in the X-Export-Id response header.
 */
app.post("/download", zValidator("json", exportRequestSchema), async (c) => {
  const request = c.req.valid("json");

  // Authenticate
  const session = await getServerAuthSession({ req: c.req.raw as NextRequest });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  // Authorize
  const hasPermission = await hasProjectPermission(
    { prisma, session },
    request.projectId,
    "traces:view",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  // Derive RBAC protections from the user's session and project role
  const protections = await getUserProtectionsForProject(
    { prisma, session },
    { projectId: request.projectId },
  );

  logger.info(
    { projectId: request.projectId, mode: request.mode, format: request.format },
    "Starting trace export download",
  );

  const exportId = crypto.randomUUID();
  const broadcast = getApp().broadcast;

  // Build file name: {project_id} - Traces - {YYYY-MM-DD} - {mode}.{ext}
  const today = new Date().toISOString().slice(0, 10);
  const extension = request.format === "csv" ? "csv" : "jsonl";
  const fileName = `${request.projectId} - Traces - ${today} - ${request.mode}.${extension}`;

  const contentType =
    request.format === "csv"
      ? "text/csv; charset=utf-8"
      : "application/x-ndjson";

  let exportService: Awaited<ReturnType<typeof ExportService.create>>;
  let totalCount: number;
  try {
    exportService = await ExportService.create();
    totalCount = await exportService.getTotalCount({ request, protections });
  } catch (error) {
    throw error;
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Transfer-Encoding": "chunked",
    "X-Export-Id": exportId,
    "X-Total-Traces": String(totalCount),
    "Access-Control-Expose-Headers": "X-Export-Id, X-Total-Traces, Content-Disposition",
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const { chunk, progress } of exportService.exportTraces({ request, protections })) {
          controller.enqueue(encoder.encode(chunk));
          void broadcast.broadcastToTenant(
            request.projectId,
            JSON.stringify({
              exportId,
              type: "progress",
              exported: progress.exported,
              total: progress.total,
            }),
            "export_progress",
          );
        }
        void broadcast.broadcastToTenant(
          request.projectId,
          JSON.stringify({ exportId, type: "done" }),
          "export_progress",
        );
        controller.close();
      } catch (error) {
        logger.error(
          { error, projectId: request.projectId },
          "Export stream error",
        );
        void broadcast.broadcastToTenant(
          request.projectId,
          JSON.stringify({ exportId, type: "error", message: "Export failed" }),
          "export_progress",
        );
        controller.error(error);
      }
    },
  });

  return new Response(stream, { headers });
});
