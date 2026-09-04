/**
 * `POST /api/export/traces/download`, composed from this process's own graph.
 *
 * The bulk trace download, beside the bulk run download one file over. Both are
 * SESSION doors and both stream: a person asks for their project's captured
 * traces as CSV or JSONL, the bytes go straight to the response, and the
 * progress is broadcast to the tenant so a tRPC subscription on any pod can
 * relay it back to the browser that asked.
 *
 * Three things decide whether it is mounted at all: the browser-session
 * transport (an export is attributable to a person by design), the trace read
 * stack (which is what the export reads THROUGH, redactions and all) and the
 * broadcast fabric (the progress has nowhere to go without it). Missing any of
 * them leaves the family off rather than mounting a door that refuses every
 * caller.
 *
 * The request schema is joined HERE. The trace package publishes everything a
 * download request states except which filters narrow it, because the filter
 * vocabulary is Analytics's and a trace package may not reach into another
 * feature's server package for it. The process holds both, so the process is
 * where the two halves meet — the same seam the read stack's own filter
 * translator crosses.
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
      cause,
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
      exports: () => TraceExportService.create({ traceService: reads.readers().tree }),
      broadcast: options.broadcast,
      unauthenticatedError: () => new TraceExportUnauthenticatedError(),
      exportFailedError: (cause) => new TraceExportFailedError(cause),
    },
  }).hono;
}
