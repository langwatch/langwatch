/**
 * Hono app for scenario run export endpoints.
 *
 * POST /download — Streams scenario run history as CSV.
 *
 * This is the API layer: HTTP concerns only (auth, headers, streaming). All
 * domain logic lives in ScenarioRunExportService.
 *
 * Progress is broadcast via BroadcastService (Redis pub/sub) so a tRPC
 * subscription on any pod can relay it to the client, exactly as trace export
 * does — the export id travels back in the X-Export-Id response header.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { hasProjectPermission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { getServerAuthSession } from "~/server/auth";
import { auditLog } from "~/server/auditLog";
import { prisma } from "~/server/db";
import {
  ScenarioRunExportForbiddenError,
  ScenarioRunExportUnauthenticatedError,
} from "~/server/export/scenario-runs/errors";
import type { ScenarioRunExportService } from "~/server/export/scenario-runs/scenario-run-export.service";
import {
  scenarioRunExportRequestSchema,
  type ScenarioRunExportRequest,
} from "~/server/export/scenario-runs/types";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("langwatch:api:export-scenario-runs");

const secured = createServiceApp({ basePath: "/api/export/scenario-runs" });

secured
  .access(handlerManagedAuth("user session + scenarios:view enforced in-handler"))
  .post(
    "/download",
    zValidator("json", scenarioRunExportRequestSchema),
    async (c) => {
      const request = c.req.valid("json");

      const session = await getServerAuthSession({ req: c.req.raw });
      if (!session) {
        throw new ScenarioRunExportUnauthenticatedError();
      }

      const hasPermission = await hasProjectPermission(
        { prisma, session },
        request.projectId,
        "scenarios:view",
      );
      if (!hasPermission) {
        throw new ScenarioRunExportForbiddenError(request.projectId);
      }

      logger.info(
        { projectId: request.projectId, mode: request.mode },
        "Starting scenario run export download",
      );

      // A bulk export lifts a project's whole run history — full mode includes
      // every conversation transcript — so the download has to be attributable
      // to a user, not just permitted. Recorded before a byte is streamed.
      await auditLog({
        userId: session.user.id,
        projectId: request.projectId,
        action: "scenarioRuns.export",
        targetKind: "project",
        targetId: request.projectId,
        args: {
          mode: request.mode,
          scenarioSetId: request.scenarioSetId,
          scenarioId: request.scenarioId,
          passFailStatus: request.passFailStatus,
          startDate: request.startDate,
          endDate: request.endDate,
        },
      });

      const exportId = generate(KSUID_RESOURCES.EXPORT).toString();
      const broadcast = getApp().broadcast;

      const today = new Date().toISOString().slice(0, 10);
      // Content-Disposition's filename is a quoted-string. projectId is only
      // constrained to `z.string()`, so a quote in it would close the quote and
      // let the caller append parameters. Server-generated ids never contain
      // one today, but nothing in the code enforces that.
      const safeProjectId = request.projectId.replace(/[^\w.-]/g, "_");
      const fileName = `${safeProjectId} - Scenario Runs - ${today} - ${request.mode}.csv`;

      const service = getApp().simulations.export;
      const totalCount = await service.getTotalCount({ request });

      // CSV of repeated run-level values compresses ~9x, and the browser
      // inflates it transparently before writing the .csv to disk — so this is
      // a pure transfer win with no change to the file the user ends up with.
      const headers = new Headers({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Encoding": "gzip",
        Vary: "Accept-Encoding",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Export-Id": exportId,
        "X-Total-Runs": String(totalCount),
        "Access-Control-Expose-Headers":
          "X-Export-Id, X-Total-Runs, Content-Disposition",
      });
      const stream = buildExportStream({
        service,
        request,
        exportId,
        totalCount,
        signal: c.req.raw.signal,
        broadcast,
      });

      return new Response(
        stream.pipeThrough(new CompressionStream("gzip")),
        { headers },
      );
    },
  );

/**
 * Drives the export generator into a ReadableStream, broadcasting progress as
 * chunks land.
 *
 * Split out of the handler so that reads as auth → audit → headers → respond.
 * Progress rides Redis pub/sub rather than the response body because the file
 * is a download: the bytes go to disk, so the only way the page can show a
 * count is out of band.
 */
function buildExportStream({
  service,
  request,
  exportId,
  totalCount,
  signal,
  broadcast,
}: {
  service: ScenarioRunExportService;
  request: ScenarioRunExportRequest;
  exportId: string;
  totalCount: number;
  signal: AbortSignal;
  broadcast: ReturnType<typeof getApp>["broadcast"];
}) {
  const encoder = new TextEncoder();
  const publish = (payload: Record<string, unknown>) =>
    void broadcast.broadcastToTenant(
      request.projectId,
      JSON.stringify({ exportId, ...payload }),
      "export_progress",
    );

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const { chunk, progress } of service.exportRuns({
          request,
          signal,
          total: totalCount,
        })) {
          controller.enqueue(encoder.encode(chunk));
          publish({
            type: "progress",
            exported: progress.exported,
            total: progress.total,
          });
        }
        publish({ type: "done" });
        controller.close();
      } catch (error) {
        logger.error(
          { error, projectId: request.projectId },
          "Scenario run export stream error",
        );
        publish({ type: "error", message: "Export failed" });
        controller.error(error);
      }
    },
  });
}

export const app = secured.hono;
