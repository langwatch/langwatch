/**
 * `POST /api/export/traces/download`, composed from this process's own graph. The bulk
 * trace download, beside the bulk run download one file over.
 */
import type { AppRestBroadcast, AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { sharedFiltersInputSchema } from "@langwatch/analytics-server";
import {
  createExportTracesRestApp,
  TraceExportService,
  traceExportRequestShape,
} from "@langwatch/trace-server";
import { z } from "zod";

import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session";
import type { ApiTraceReadStackPort } from "../trace/trace.composition";

/**
 * A download request as a caller sends it: the trace package's own shape plus
 * the filter selection, which is Analytics's.
 */
const traceExportRequestSchema = z.object({
  ...traceExportRequestShape,
  filters: sharedFiltersInputSchema.shape.filters,
});

/** Nobody is signed in, so there is no person to attribute the download to. */
class TraceExportUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Sign in to export traces", { httpStatus: 401, fault: "customer" });
    this.name = "TraceExportUnauthenticatedError";
  }
}

/**
 * The export could not be produced and the failure had nothing handled to say
 * for itself. The cause rides the reason chain, so the log line keeps it while
 * the caller reads copy the registry writes.
 */
class TraceExportFailedError extends HandledError {
  declare readonly code: "internal_error";

  constructor(cause: unknown) {
    super("internal_error", "The trace export could not be produced", {
      httpStatus: 500,
      fault: "platform",
      // The reason chain is where a handled error carries what went wrong: the
      // log line keeps it, and the caller still reads the registry's copy.
      reasons: [cause instanceof Error ? cause : new Error(String(cause))],
    });
    this.name = "TraceExportFailedError";
  }
}

export type ApiTraceExportRestOptions = Readonly<{
  security: AppRestSecurity;
  /** The one read stack every trace surface on this process redacts through. */
  reads: ApiTraceReadStackPort;
  /** The one session port every handler-managed family on this process reads. */
  session: ApiHandlerManagedSessionPort;
  /** Fan-out to every browser watching this tenant, for the progress relay. */
  broadcast: () => AppRestBroadcast;
}>;

/** Builds the download family over this process's read stack and session. */
export function mountApiTraceExportRest(options: ApiTraceExportRestOptions): MountableRestApp {
  const { reads, session } = options;

  return createExportTracesRestApp({
    security: options.security,
    ports: {
      requestSchema: traceExportRequestSchema,
      resolveSession: (request) => session.resolve(request),
      probeProjectPermission: (resolved, projectId, permission) =>
        session.permitted({ session: resolved, projectId, permission }),
      // The SAME redactions the explorer and the waterfall read through,
      // resolved for the person who asked rather than for the project.
      getViewerProtections: (resolved, input) =>
        reads.getViewerProtections({ session: { user: { id: resolved.user.id } } }, input),
      // Resolved per request, never at mount: the port says so, and mounting a
      // family must not force the read stack behind it to be constructed.
      // The LEGACY read, which is the one that answers `getAllTracesForProject`
      // — the export's whole loop. `tree` is the contract-shaped reader beside
      // it and carries no such method.
      exports: () => TraceExportService.create({ traceService: reads.readers().read }),
      broadcast: options.broadcast,
      unauthenticatedError: () => new TraceExportUnauthenticatedError(),
      exportFailedError: (cause) => new TraceExportFailedError(cause),
    },
  }).hono;
}
