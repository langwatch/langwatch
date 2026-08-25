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

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import crypto from "crypto";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { getUserProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { ExportFailedError, ExportUnauthenticatedError } from "~/server/export/errors";
import { ExportService } from "~/server/export/export.service";
import { exportRequestSchema } from "~/server/export/types";
import type { NextRequest } from "~/types/next-stubs";

const logger = createLogger("langwatch:api:export-traces");

const secured = createServiceApp({ basePath: "/api/export/traces" });

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
secured
  .access(
    handlerManagedAuth({
      reason: "user session + traces:view enforced in-handler",
      permissions: ["traces:view"],
      credential: "session",
    }),
  )
  .post("/download", zValidator("json", exportRequestSchema), async (c) => {
    const request = c.req.valid("json");

    // Authenticate
    const session = await getServerAuthSession({
      req: c.req.raw as NextRequest,
    });
    if (!session) {
      // Thrown, not hand-rolled: `createServiceApp`'s onError serialises a
      // HandledError with its code, which is what lets the browser render the
      // registry's copy instead of an unrecognisable prose blob.
      throw new ExportUnauthenticatedError();
    }

    // Authorize
    const hasPermission = await probeProjectPermission(
      { session },
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
      {
        projectId: request.projectId,
        mode: request.mode,
        format: request.format,
      },
      "Starting trace export download",
    );

    const exportId = crypto.randomUUID();
    const broadcast = c.app.broadcast;

    // Build file name: {project_id} - Traces - {YYYY-MM-DD} - {mode}.{ext}
    const today = new Date().toISOString().slice(0, 10);
    const extension = request.format === "csv" ? "csv" : "jsonl";
    const fileName = `${request.projectId} - Traces - ${today} - ${request.mode}.${extension}`;

    const contentType =
      request.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson";

    let exportService: Awaited<ReturnType<typeof ExportService.create>>;
    let totalCount: number;
    try {
      exportService = await ExportService.create();
      totalCount = await exportService.getTotalCount({ request, protections });
    } catch (error) {
      // A failure that already knows what it is — a query timeout, a time range
      // too wide, ClickHouse unavailable — says something more useful than
      // "the export failed", so it travels untouched. Anything else becomes the
      // generic export failure, which at least tells the user nothing was
      // changed; the cause rides its reason chain for the log line.
      if (HandledError.isHandled(error)) throw error;
      throw new ExportFailedError(error);
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
          for await (const { chunk, progress } of exportService.exportTraces({
            request,
            protections,
          })) {
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
          logger.error({ error, projectId: request.projectId }, "Export stream error");
          void broadcast.broadcastToTenant(
            request.projectId,
            JSON.stringify({
              exportId,
              type: "error",
              message: "Export failed",
            }),
            "export_progress",
          );
          controller.error(error);
        }
      },
    });

    return new Response(stream, { headers });
  });

export const app = secured.hono;
