/**
 * `POST /api/export/scenario-runs/download`: streams run history as gzipped CSV.
 * Broadcasts progress; permission from body projectId. See scenario-run-export.feature.
 */
import { deferredScope } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type AppRestBroadcast } from "@langwatch/api/rest";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { createLogger } from "@langwatch/observability";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import type { z } from "zod";

const logger = createLogger("langwatch:api:export-scenario-runs");

/** What this route reads out of an export request; the rest is forwarded. */
export type ScenarioRunExportRequestFields = Readonly<{
  projectId: string;
  mode: string;
  scenarioSetId?: string | undefined;
  scenarioId?: string | undefined;
  passFailStatus?: string | undefined;
  startDate?: number | undefined;
  endDate?: number | undefined;
}>;

/** One progress snapshot, emitted alongside each chunk. */
type ScenarioRunExportProgress = Readonly<{ exported: number; total: number }>;

/** The export, as this route uses it. */
export interface ScenarioRunExport<TRequest> {
  /** How many runs the sweep will visit, for the caller's progress bar. */
  getTotalCount(input: Readonly<{ request: TRequest }>): Promise<number>;
  /** The serialized export, one chunk at a time. */
  exportRuns(
    input: Readonly<{ request: TRequest; signal?: AbortSignal; total?: number }>,
  ): AsyncIterable<Readonly<{ chunk: string; progress: ScenarioRunExportProgress }>>;
}

/**
 * What the scenario run export download needs from the process. Method
 * syntax throughout, so a host may name its own concrete session and
 * request types rather than restating the widened ones here.
 */
export interface ScenarioRunExportRestPorts<
  TRequest extends ScenarioRunExportRequestFields,
  TRequestRaw,
  TSession extends Readonly<{ user: Readonly<{ id: string }> }>,
> {
  /**
   * The export request as a caller sends it. Both the parsed shape and the
   * sent shape are carried, since they can differ and the 400 body is built
   * off the sent one.
   */
  requestSchema: z.ZodType<TRequest, TRequestRaw>;
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `scenarios:view` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "scenarios:view",
  ): Promise<boolean>;
  /**
   * A bulk export lifts a project's whole run history - full mode includes
   * every conversation transcript - so the download has to be attributable to
   * a user, not just permitted. Recorded before a byte is streamed.
   */
  recordExportRequested(entry: {
    userId: string;
    projectId: string;
    action: "scenarioRuns.export";
    targetKind: "project";
    targetId: string;
    args: Record<string, unknown>;
  }): Promise<void>;
  /** The export itself. Resolved per request, never constructed at mount. */
  exports(): ScenarioRunExport<TRequest>;
  /** Fans one progress event out to every pod serving this tenant. */
  broadcast(): AppRestBroadcast;
  /** The correlation handle the browser subscribes to progress under. */
  newExportId(): string;
  /**
   * No live session behind the request. Thrown, not hand-rolled: the boundary
   * serialises it with its code alongside the trace and span ids, which a
   * hand-rolled body would drop entirely.
   */
  unauthenticatedError(): Error;
  /** The session is valid but does not hold `scenarios:view` on the project. */
  forbiddenError(projectId: string): Error;
}

const DOOR_REASON =
  "the caller's projectId arrives in the body, not the credential's own scope, so the session and its scenarios:view permission are resolved and probed in the handler";

/** `/api/export/scenario-runs/download`, bound to one process's ports. */
export function createScenarioRunExportRest<
  TRequest extends ScenarioRunExportRequestFields,
  TRequestRaw,
  TSession extends Readonly<{ user: Readonly<{ id: string }> }>,
>(ports: ScenarioRunExportRestPorts<TRequest, TRequestRaw, TSession>) {
  return defineRestRouter(ScenarioApi)
    .withNamespace("export/scenario-runs")
    .withVersion(MANAGEMENT_API_VERSION)
    .withAddressing("literal", { v1Twin: false })

    .post("/download", "downloadScenarioRunExport")
    .withRawBody("text", { mediaType: "application/json" })
    .withAccess(deferredScope({ reason: DOOR_REASON }))
    .withRawResponse({ produces: "text/csv" })
    .withDocs({ description: "Stream a project's simulation run history as gzipped CSV" })
    .handle(async ({ raw, request }) => {
      const parsed = ports.requestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: parsed.error.message }),
        };
      }
      const exportRequest = parsed.data;

      const session = await ports.resolveSession(request);
      if (!session) throw ports.unauthenticatedError();

      const hasPermission = await ports.probeProjectPermission(
        session,
        exportRequest.projectId,
        "scenarios:view",
      );
      if (!hasPermission) throw ports.forbiddenError(exportRequest.projectId);

      logger.info(
        { projectId: exportRequest.projectId, mode: exportRequest.mode },
        "Starting scenario run export download",
      );

      await ports.recordExportRequested({
        userId: session.user.id,
        projectId: exportRequest.projectId,
        action: "scenarioRuns.export",
        targetKind: "project",
        targetId: exportRequest.projectId,
        args: {
          mode: exportRequest.mode,
          scenarioSetId: exportRequest.scenarioSetId,
          scenarioId: exportRequest.scenarioId,
          passFailStatus: exportRequest.passFailStatus,
          startDate: exportRequest.startDate,
          endDate: exportRequest.endDate,
        },
      });

      const exportId = ports.newExportId();
      const broadcast = ports.broadcast();

      const today = new Date().toISOString().slice(0, 10);
      // Content-Disposition's filename is a quoted-string. projectId is only
      // constrained to `z.string()`, so a quote in it would close the quote and
      // let the caller append parameters. Server-generated ids never contain
      // one today, but nothing in the code enforces that.
      const safeProjectId = exportRequest.projectId.replace(/[^\w.-]/g, "_");
      const fileName = `${safeProjectId} - Scenario Runs - ${today} - ${exportRequest.mode}.csv`;

      const service = ports.exports();
      const totalCount = await service.getTotalCount({ request: exportRequest });

      // CSV of repeated run-level values compresses ~9x, and the browser
      // inflates it transparently before writing the .csv to disk - so this is
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
        request: exportRequest,
        exportId,
        totalCount,
        signal: request.signal,
        broadcast,
      });

      return new Response(gzipped(stream), { headers });
    })

    .build();
}

/**
 * Gzips stream while letting backpressure reach producer (pipeThrough doesn't honor it).
 * zlib through Node's stream honors high-water mark, limiting read-ahead to ~800KB.
 */
function gzipped(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const gzip = createGzip();
  const nodeSource = Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]);

  // `.pipe()` does not forward a source error the way `pipeThrough` does: it
  // unpipes and leaves the destination open, and the Readable's own 'error'
  // event goes unhandled - which takes the process down rather than failing
  // the one request. Destroying the gzip with the error propagates it to the
  // response instead, so a failed query reads as a failed download.
  nodeSource.on("error", (error) => gzip.destroy(error));
  nodeSource.pipe(gzip);

  return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}

/**
 * Drives the export generator into a ReadableStream, broadcasting progress
 * as chunks land. Progress rides the tenant broadcast, not the response
 * body, since the file downloads to disk and a count can only ride out of band.
 */
function buildExportStream<TRequest extends ScenarioRunExportRequestFields>({
  service,
  request,
  exportId,
  totalCount,
  signal,
  broadcast,
}: {
  service: ScenarioRunExport<TRequest>;
  request: TRequest;
  exportId: string;
  totalCount: number;
  signal: AbortSignal;
  broadcast: AppRestBroadcast;
}) {
  const encoder = new TextEncoder();
  const publish = (payload: Record<string, unknown>) =>
    void broadcast.broadcastToTenant(
      request.projectId,
      JSON.stringify({ exportId, ...payload }),
      "export_progress",
    );

  const runs = service.exportRuns({ request, signal, total: totalCount })[Symbol.asyncIterator]();

  // One page per pull() rather than the whole sweep in start(): start() runs
  // to completion regardless of desiredSize, holding a full export (every
  // transcript) in memory. pull() runs only when the stream wants more, so a
  // stopped consumer stops the sweep and backpressure reaches the producer.
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

    // The client went away - closed the tab, hit Cancel, lost the connection.
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
