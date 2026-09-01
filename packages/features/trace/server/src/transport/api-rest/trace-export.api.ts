/**
 * REST for the trace export download.
 *
 * `POST /api/export/traces/download` streams the export as CSV or JSONL
 * straight to the response, and broadcasts progress to the tenant so a tRPC
 * subscription on any pod can relay it to the browser that asked. The export
 * id rides back on the `X-Export-Id` response header.
 *
 * This is the HTTP layer: authentication, authorization, headers and
 * streaming. Everything else arrives as a port — the session, the permission
 * probe, the caller's read-time redactions, the export itself, the tenant
 * broadcast, and the two errors the application's registry writes copy for.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import crypto from "crypto";
import type { Env } from "hono";
import type { z } from "zod";
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestBroadcast,
  type AppRestSecurity,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:export-traces");

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
   * they can differ, and the validator types the 400 body off the sent shape.
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
   * The caller's read-time redactions for one project — cost visibility, the
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

/**
 * REST for the trace export download, built against one process's security.
 */
export function createExportTracesRestApp<
  TRequest extends TraceExportRequestFields,
  TRequestRaw,
  TSession,
>(options: {
  security: AppRestSecurity;
  ports: TraceExportRestPorts<TRequest, TRequestRaw, TSession>;
}): SecuredApp<Env> {
  const { security, ports } = options;

  const secured = security.createServiceApp({ basePath: "/api/export/traces" });

  /**
   * POST /download — Stream trace data as a file download.
   *
   * Authenticates via session, checks traces:view permission, then streams
   * CSV or JSONL data from the export's async generator directly to the HTTP
   * response. Sets Content-Disposition for browser file download.
   *
   * Broadcasts progress events so any pod's tRPC subscription can relay them
   * to the client. The export ID is returned in the X-Export-Id header.
   */
  secured
    .access(
      handlerManagedAuth({
        reason: "user session + traces:view enforced in-handler",
        permissions: ["traces:view"],
        credential: "session",
      }),
    )
    .post("/download", zValidator("json", ports.requestSchema), async (c) => {
      const request = c.req.valid("json");

      // Authenticate
      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        throw ports.unauthenticatedError();
      }

      // Authorize
      const hasPermission = await ports.probeProjectPermission(
        session,
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
      const protections = await ports.getViewerProtections(session, {
        projectId: request.projectId,
      });

      logger.info(
        {
          projectId: request.projectId,
          mode: request.mode,
          format: request.format,
        },
        "Starting trace export download",
      );

      const exportId = crypto.randomUUID();
      const broadcast = ports.broadcast();

      // Build file name: {project_id} - Traces - {YYYY-MM-DD} - {mode}.{ext}
      const today = new Date().toISOString().slice(0, 10);
      const extension = request.format === "csv" ? "csv" : "jsonl";
      const fileName = `${request.projectId} - Traces - ${today} - ${request.mode}.${extension}`;

      const contentType =
        request.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson";

      const exportService = ports.exports();
      let totalCount: number;
      try {
        totalCount = await exportService.getTotalCount({ request, protections });
      } catch (error) {
        // A failure that already knows what it is — a query timeout, a time range
        // too wide, ClickHouse unavailable — says something more useful than
        // "the export failed", so it travels untouched. Anything else becomes the
        // generic export failure, which at least tells the user nothing was
        // changed; the cause rides its reason chain for the log line.
        if (HandledError.isHandled(error)) throw error;
        throw ports.exportFailedError(error);
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

  return secured;
}
