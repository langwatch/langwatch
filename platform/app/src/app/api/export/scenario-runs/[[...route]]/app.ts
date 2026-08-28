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

import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { auditLog } from "~/runtime/app/features/audit-log";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { createServiceApp } from "~/server/api/security";
import { handlerManagedAuth, validator as zValidator } from "@langwatch/platform-api/app-rest";
import type { App } from "~/server/app-layer/app";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import {
  ScenarioRunExportForbiddenError,
  ScenarioRunExportUnauthenticatedError,
} from "~/server/export/scenario-runs/errors";
import type { ScenarioRunExportService } from "~/server/export/scenario-runs/scenario-run-export.service";
import {
  type ScenarioRunExportRequest,
  scenarioRunExportRequestSchema,
} from "~/server/export/scenario-runs/types";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("langwatch:api:export-scenario-runs");

const secured = createServiceApp({ basePath: "/api/export/scenario-runs" });

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      permissions: ["scenarios:view"],
      credential: "session",
    }),
  )
  .post("/download", zValidator("json", scenarioRunExportRequestSchema), async (c) => {
    const request = c.req.valid("json");

    const session = await getServerAuthSession({ app: c.app, req: c.req.raw });
    if (!session) {
      throw new ScenarioRunExportUnauthenticatedError();
    }

    const hasPermission = await probeProjectPermission(
      { session },
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
    const broadcast = c.app.broadcast;

    const today = new Date().toISOString().slice(0, 10);
    // Content-Disposition's filename is a quoted-string. projectId is only
    // constrained to `z.string()`, so a quote in it would close the quote and
    // let the caller append parameters. Server-generated ids never contain
    // one today, but nothing in the code enforces that.
    const safeProjectId = request.projectId.replace(/[^\w.-]/g, "_");
    const fileName = `${safeProjectId} - Scenario Runs - ${today} - ${request.mode}.csv`;

    const service = c.app.simulationExports;
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
      "Access-Control-Expose-Headers": "X-Export-Id, X-Total-Runs, Content-Disposition",
    });
    const stream = buildExportStream({
      service,
      request,
      exportId,
      totalCount,
      signal: c.req.raw.signal,
      broadcast,
    });

    return new Response(gzipped(stream), { headers });
  });

/**
 * Gzips a stream while letting backpressure reach its producer.
 *
 * `pipeThrough(new CompressionStream("gzip"))` does not: the transform drains
 * whatever it is piped from without bound, so a paused reader still leaves the
 * producer running flat out. Measured on this route's own shape — one read,
 * then stop — a raw pull-driven source is asked for 2 more pages, the same
 * source through CompressionStream for ~65,000. That is the whole export in
 * memory for one slow client.
 *
 * zlib through Node's stream plumbing honours the pipe's high-water mark, so
 * read-ahead is bounded in bytes (~800KB here) rather than in pages, and a
 * bigger page simply means fewer of them buffered.
 */
function gzipped(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const gzip = createGzip();
  const nodeSource = Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]);

  // `.pipe()` does not forward a source error the way `pipeThrough` does: it
  // unpipes and leaves the destination open, and the Readable's own 'error'
  // event goes unhandled — which takes the process down rather than failing
  // the one request. Destroying the gzip with the error propagates it to the
  // response instead, so a failed query reads as a failed download.
  nodeSource.on("error", (error) => gzip.destroy(error));
  nodeSource.pipe(gzip);

  return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}

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
  broadcast: App["broadcast"];
}) {
  const encoder = new TextEncoder();
  const publish = (payload: Record<string, unknown>) =>
    void broadcast.broadcastToTenant(
      request.projectId,
      JSON.stringify({ exportId, ...payload }),
      "export_progress",
    );

  const runs = service.exportRuns({ request, signal, total: totalCount })[Symbol.asyncIterator]();

  // One page per pull() rather than the whole sweep in start().
  //
  // start() runs to completion regardless of controller.desiredSize, so it
  // would keep querying and enqueuing for a slow client until the whole export
  // sat in the pod's memory — a full-mode file is every transcript in the
  // project. pull() is called only when the stream wants more, so a consumer
  // that stops reading stops the sweep, and gzip's own buffering no longer
  // hides the producer from backpressure.
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await runs.next();
        if (next.done) {
          publish({ type: "done" });
          controller.close();
          return;
        }
        const { chunk, progress } = next.value;
        controller.enqueue(encoder.encode(chunk));
        publish({
          type: "progress",
          exported: progress.exported,
          total: progress.total,
        });
      } catch (error) {
        logger.error({ error, projectId: request.projectId }, "Scenario run export stream error");
        publish({ type: "error", message: "Export failed" });
        controller.error(error);
      }
    },

    // The client went away — closed the tab, hit Cancel, lost the connection.
    // Returning the generator runs its `finally`, so the sweep stops instead of
    // paging ClickHouse to exhaustion for a download nobody is reading.
    async cancel(reason) {
      logger.info(
        { projectId: request.projectId, exportId, reason },
        "Scenario run export cancelled by the consumer",
      );
      await runs.return?.(undefined);
    },
  });
}

export const app = secured.hono;
