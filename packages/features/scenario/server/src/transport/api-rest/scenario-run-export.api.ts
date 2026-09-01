/**
 * REST for the scenario run export download.
 *
 * `POST /api/export/scenario-runs/download` streams a project's run history as
 * gzipped CSV straight to the response, and broadcasts progress to the tenant
 * so a tRPC subscription on any pod can relay it to the browser that asked.
 * The export id rides back on the `X-Export-Id` response header.
 *
 * This is the HTTP layer: authentication, authorization, the audit record,
 * headers and streaming. Everything else arrives as a port — the request
 * schema, the session, the permission probe, the audit sink, the export
 * itself, the tenant broadcast, the export id and the two refusals the
 * application's registry writes copy for. The same shape the trace export
 * next door is built with, because the two downloads differ only in what they
 * serialize.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestBroadcast,
  type AppRestSecurity,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { Env } from "hono";
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
export interface ScenarioRunExportPort<TRequest> {
  /** How many runs the sweep will visit, for the caller's progress bar. */
  getTotalCount(input: Readonly<{ request: TRequest }>): Promise<number>;
  /** The serialized export, one chunk at a time. */
  exportRuns(
    input: Readonly<{ request: TRequest; signal?: AbortSignal; total?: number }>,
  ): AsyncIterable<Readonly<{ chunk: string; progress: ScenarioRunExportProgress }>>;
}

/**
 * What the scenario run export download needs from the process.
 *
 * Method syntax throughout, so a host may name its own concrete session and
 * request types rather than restating the widened ones here.
 */
export interface ScenarioRunExportRestPorts<
  TRequest extends ScenarioRunExportRequestFields,
  TRequestRaw,
  TSession extends Readonly<{ user: Readonly<{ id: string }> }>,
> {
  /**
   * The export request as a caller sends it.
   *
   * Both the parsed shape and the shape a caller SENDS are carried, because
   * they can differ, and the validator types the 400 body off the sent shape.
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
   * A bulk export lifts a project's whole run history — full mode includes
   * every conversation transcript — so the download has to be attributable to
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
  exports(): ScenarioRunExportPort<TRequest>;
  /** Fans one progress event out to every pod serving this tenant. */
  broadcast(): AppRestBroadcast;
  /** The correlation handle the browser subscribes to progress under. */
  newExportId(): string;
  /**
   * No live session behind the request. Thrown, not hand-rolled: the boundary
   * serialises it with its code alongside the trace and span ids, which a
   * hand-rolled `c.json({ error }, 401)` drops entirely.
   */
  unauthenticatedError(): Error;
  /** The session is valid but does not hold `scenarios:view` on the project. */
  forbiddenError(projectId: string): Error;
}

/**
 * REST for the scenario run export download, built against one process's
 * security.
 */
export function createScenarioRunExportRestApp<
  TRequest extends ScenarioRunExportRequestFields,
  TRequestRaw,
  TSession extends Readonly<{ user: Readonly<{ id: string }> }>,
>(options: {
  security: AppRestSecurity;
  ports: ScenarioRunExportRestPorts<TRequest, TRequestRaw, TSession>;
}): SecuredApp<Env> {
  const { security, ports } = options;

  const secured = security.createServiceApp({ basePath: "/api/export/scenario-runs" });

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler via the process's session resolver",
        permissions: ["scenarios:view"],
        credential: "session",
      }),
    )
    .post("/download", zValidator("json", ports.requestSchema), async (c) => {
      const request = c.req.valid("json");

      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        throw ports.unauthenticatedError();
      }

      const hasPermission = await ports.probeProjectPermission(
        session,
        request.projectId,
        "scenarios:view",
      );
      if (!hasPermission) {
        throw ports.forbiddenError(request.projectId);
      }

      logger.info(
        { projectId: request.projectId, mode: request.mode },
        "Starting scenario run export download",
      );

      await ports.recordExportRequested({
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

      const exportId = ports.newExportId();
      const broadcast = ports.broadcast();

      const today = new Date().toISOString().slice(0, 10);
      // Content-Disposition's filename is a quoted-string. projectId is only
      // constrained to `z.string()`, so a quote in it would close the quote and
      // let the caller append parameters. Server-generated ids never contain
      // one today, but nothing in the code enforces that.
      const safeProjectId = request.projectId.replace(/[^\w.-]/g, "_");
      const fileName = `${safeProjectId} - Scenario Runs - ${today} - ${request.mode}.csv`;

      const service = ports.exports();
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

  return secured;
}

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
 * Progress rides the tenant broadcast rather than the response body because
 * the file is a download: the bytes go to disk, so the only way the page can
 * show a count is out of band.
 */
function buildExportStream<TRequest extends ScenarioRunExportRequestFields>({
  service,
  request,
  exportId,
  totalCount,
  signal,
  broadcast,
}: {
  service: ScenarioRunExportPort<TRequest>;
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
