/**
 * Hono app for trace export endpoints.
 *
 * Two endpoints:
 * - POST /download — Streams exported trace data as CSV or JSONL
 * - GET /progress/:exportId — SSE sideband for real-time progress updates
 *
 * This is the API layer: it handles HTTP concerns (auth, headers, streaming)
 * and delegates all domain logic to ExportService.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import crypto from "crypto";

import { handleError } from "../../../middleware/error-handler";
import { loggerMiddleware } from "../../../middleware/logger";
import { tracerMiddleware } from "../../../middleware/tracer";
import { hasProjectPermission } from "~/server/api/rbac";
import { getUserProtectionsForProject } from "~/server/api/utils";
import { authOptions } from "~/server/auth";
import { prisma } from "~/server/db";
import { ExportService } from "~/server/export/export.service";
import { exportRequestSchema } from "~/server/export/types";
import { createLogger } from "~/utils/logger/server";
import {
  createProgressEmitter,
  getProgressEmitter,
  removeProgressEmitter,
} from "../progress-emitter";

const logger = createLogger("langwatch:api:export-traces");

/** Delay before cleaning up progress emitters after export completes (ms). */
const PROGRESS_CLEANUP_DELAY_MS = 5000;

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
 * Emits progress events on an in-memory EventEmitter so the SSE sideband
 * can relay them to the client. The export ID is returned in the
 * X-Export-Id response header.
 */
app.post("/download", zValidator("json", exportRequestSchema), async (c) => {
  const request = c.req.valid("json");

  // Authenticate
  const session = await getServerSession(authOptions(c.req.raw as NextRequest));
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

  // Set up progress coordination
  const exportId = crypto.randomUUID();
  const userId = session.user?.id ?? "";
  const progressEmitter = createProgressEmitter({
    exportId,
    userId,
    projectId: request.projectId,
  });

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
    removeProgressEmitter(exportId);
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
          progressEmitter.emit("progress", progress);
        }
        progressEmitter.emit("done");
        controller.close();
      } catch (error) {
        logger.error(
          { error, projectId: request.projectId },
          "Export stream error",
        );
        if (progressEmitter.listenerCount("error") > 0) {
          progressEmitter.emit("error", error);
        }
        controller.error(error);
      } finally {
        // Clean up after a short delay to allow SSE clients to receive final events
        setTimeout(() => removeProgressEmitter(exportId), PROGRESS_CLEANUP_DELAY_MS);
      }
    },
  });

  return new Response(stream, { headers });
});

/**
 * GET /progress/:exportId — SSE sideband for export progress.
 *
 * Streams progress events as Server-Sent Events. The client connects
 * to this endpoint using the export ID from the X-Export-Id header
 * of the download response.
 *
 * Events:
 * - progress: `{ exported: N, total: M }`
 * - done: `{ type: "done" }`
 * - error: `{ type: "error", message: "Export failed" }`
 */
app.get("/progress/:exportId", async (c) => {
  // Authenticate
  const session = await getServerSession(authOptions(c.req.raw as NextRequest));
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  const { exportId } = c.req.param();
  const entry = getProgressEmitter(exportId);

  if (!entry) {
    return c.json(
      { error: "Export not found", message: "No active export with this ID" },
      { status: 404 },
    );
  }

  // Verify the requesting user owns this export
  const requestingUserId = session.user?.id;
  if (!requestingUserId || requestingUserId !== entry.userId) {
    return c.json(
      { error: "You do not have permission to access this export." },
      { status: 403 },
    );
  }

  const { emitter } = entry;

  return streamSSE(c, async (stream) => {
    let closed = false;

    const cleanup = (resolve: () => void) => {
      emitter.removeAllListeners();
      closed = true;
      resolve();
    };

    await new Promise<void>((resolve) => {
      const onProgress = async (progress: { exported: number; total: number }) => {
        if (closed) return;
        try {
          await stream.writeSSE({
            data: JSON.stringify(progress),
            event: "progress",
          });
        } catch {
          cleanup(resolve);
        }
      };

      const onDone = async () => {
        if (closed) return;
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: "done" }),
            event: "done",
          });
        } catch {
          // Stream may have been closed
        }
        cleanup(resolve);
      };

      const onError = async (error: unknown) => {
        if (closed) return;
        // Log the full error server-side; send a generic message to the client
        logger.error({ error, exportId }, "Export progress error");
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message: "Export failed" }),
            event: "error",
          });
        } catch {
          // Stream may have been closed
        }
        cleanup(resolve);
      };

      emitter.on("progress", onProgress);
      emitter.once("done", onDone);
      emitter.once("error", onError);

      stream.onAbort(() => {
        cleanup(resolve);
      });
    });
  });
});
