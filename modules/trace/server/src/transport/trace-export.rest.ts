/**
 * REST for the trace export download.
 *
 * `POST /api/export/traces/download` streams the export as CSV or JSONL
 * straight to the response, and broadcasts progress to the tenant so a tRPC
 * subscription on any pod can relay it to the browser that asked. The export
 * id rides back on the `X-Export-Id` response header.
 *
 * This is the HTTP layer: authentication, authorization, headers and
 * streaming. Everything else arrives as a port - the session, the permission
 * probe, the caller's read-time redactions, the export itself, the tenant
 * broadcast, and the two errors the application's registry writes copy for.
 * The request schema is a port too (the deployment's own analytics filter
 * vocabulary), so the body is read raw and validated by hand rather than
 * through `withInput`, which needs a schema fixed at declaration time.
 */
import { deferredScope } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  requestValidationErrorFrom,
  type AppRestBroadcast,
  type RestRawResult,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { moduleApi } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

const logger = createLogger("langwatch:api:export-traces");

const SESSION_REASON =
  "the process's session port resolves the signed-in person and this handler checks " +
  "traces:view on the project the request body names";

/** What this route reads out of an export request; the rest is forwarded. */
export type TraceExportRequestFields = Readonly<{
  projectId: string;
  mode: string;
  format: string;
}>;

/** One progress snapshot, emitted alongside each chunk. */
type TraceExportProgress = Readonly<{ exported: number; total: number }>;

/** The export, as this route uses it. */
export interface TraceExportPort<TRequest> {
  /** How many traces the export will produce, for the caller's progress bar. */
  getTotalCount(input: Readonly<{ request: TRequest; protections: unknown }>): Promise<number>;
  /** The serialized export, one chunk at a time. */
  exportTraces(
    input: Readonly<{ request: TRequest; protections: unknown }>,
  ): AsyncIterable<Readonly<{ chunk: string; progress: TraceExportProgress }>>;
}

/**
 * What the export download needs from the process.
 *
 * Method syntax throughout, so a host may name its own concrete session,
 * protections and request types rather than restating the widened ones here.
 */
export interface TraceExportRestPorts<
  TRequest extends TraceExportRequestFields,
  TRequestRaw,
  TSession,
> {
  /**
   * The export request as a caller sends it.
   *
   * Both the parsed shape and the shape a caller SENDS are carried, because
   * they can differ, and the validator types the 422 body off the sent shape.
   */
  requestSchema: z.ZodType<TRequest, TRequestRaw>;
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `permission` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /**
   * The caller's read-time redactions for one project - cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff. Passed straight through to the export.
   */
  getViewerProtections(session: TSession, input: Readonly<{ projectId: string }>): Promise<unknown>;
  /** The export itself. Resolved per request, never constructed at mount. */
  exports(): TraceExportPort<TRequest>;
  /** Fans one progress event out to every pod serving this tenant. */
  broadcast(): AppRestBroadcast;
  /**
   * No live session behind the request. Thrown, not hand-rolled: the boundary
   * serialises it with its code, which is what lets the browser render the
   * registry's copy instead of an unrecognisable prose blob.
   */
  unauthenticatedError(): Error;
  /**
   * The export could not be produced, and the underlying failure had nothing
   * handled to say for itself. The cause rides the reason chain.
   */
  exportFailedError(cause: unknown): Error;
}

export const TraceExportApi = moduleApi<
  TraceExportRestPorts<TraceExportRequestFields, unknown, unknown>
>("trace");

/** A JSON answer this door writes itself. */
const jsonAnswer = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The rows of one export, streamed out chunk by chunk with a progress event per chunk. */
function exportStream({
  request,
  protections,
  exportId,
  exportService,
  broadcast,
}: {
  request: TraceExportRequestFields;
  protections: unknown;
  exportId: string;
  exportService: TraceExportPort<TraceExportRequestFields>;
  broadcast: AppRestBroadcast;
}): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
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
          JSON.stringify({ exportId, type: "error", message: "Export failed" }),
          "export_progress",
        );
        controller.error(error);
      }
    },
  });
}

/** The download headers: the derived file name, the format's content type, and the export id. */
function exportHeaders({
  request,
  exportId,
  totalCount,
}: {
  request: TraceExportRequestFields;
  exportId: string;
  totalCount: number;
}): Headers {
  const today = nowInstant().toString().slice(0, 10);
  const extension = request.format === "csv" ? "csv" : "jsonl";
  const fileName = `${request.projectId} - Traces - ${today} - ${request.mode}.${extension}`;
  const contentType = request.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson";

  return new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Transfer-Encoding": "chunked",
    "X-Export-Id": exportId,
    "X-Total-Traces": String(totalCount),
    "Access-Control-Expose-Headers": "X-Export-Id, X-Total-Traces, Content-Disposition",
  });
}

export const traceExportRest = defineRestRouter(TraceExportApi)
  .withNamespace("export-traces")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/export/traces/download", "downloadTraceExport")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(deferredScope({ reason: SESSION_REASON }))
  .withRawResponse({ produces: "application/octet-stream" })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }): Promise<RestRawResult> => {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw as string);
    } catch {
      return jsonAnswer({ error: "Invalid JSON body" }, 400);
    }

    const parsed = app.requestSchema.safeParse(parsedBody);
    if (!parsed.success) {
      throw requestValidationErrorFrom({ target: "json", error: parsed.error, input: parsedBody });
    }
    const request = parsed.data;

    const session = await app.resolveSession(request);
    if (!session) throw app.unauthenticatedError();

    const hasPermission = await app.probeProjectPermission(session, request.projectId, "traces:view");
    if (!hasPermission) {
      return jsonAnswer({ error: "You do not have permission to access this endpoint." }, 403);
    }

    const protections = await app.getViewerProtections(session, { projectId: request.projectId });

    logger.info(
      { projectId: request.projectId, mode: request.mode, format: request.format },
      "Starting trace export download",
    );

    const exportId = crypto.randomUUID();
    const broadcast = app.broadcast();
    const exportService = app.exports();

    let totalCount: number;
    try {
      totalCount = await exportService.getTotalCount({ request, protections });
    } catch (error) {
      // A failure that already knows what it is - a query timeout, a time range
      // too wide, ClickHouse unavailable - says something more useful than
      // "the export failed", so it travels untouched. Anything else becomes the
      // generic export failure, which at least tells the user nothing was
      // changed; the cause rides its reason chain for the log line.
      if (HandledError.isHandled(error)) throw error;
      throw app.exportFailedError(error);
    }

    const stream = exportStream({ request, protections, exportId, exportService, broadcast });

    return {
      status: 200,
      headers: Object.fromEntries(exportHeaders({ request, exportId, totalCount }).entries()),
      body: stream,
    };
  })

  .build();
