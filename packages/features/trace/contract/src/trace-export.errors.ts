import { HandledError } from "@langwatch/handled-error";

/**
 * The export could not be produced — raised when it fails to START (service could not be built, or the sizing count query blew up) and the underlying failure has nothing handled to say. Deliberately NOT a wrapper for every infra fault: an already-handled failure (`query_timeout`, `clickhouse_unavailable`, `time_range_too_wide`) says something more specific and travels on its own, with the unhandled cause riding the reason chain so the log keeps it while the customer gets copy written for them (registry: `export_failed`). `fault: platform` explicit since this is an unannotated-would-be-routine-noise 5xx.
 */
export class ExportFailedError extends HandledError {
  declare readonly code: "export_failed";

  constructor(cause?: unknown) {
    super("export_failed", "The trace export could not be produced.", {
      httpStatus: 500,
      fault: "platform",
      ...(cause instanceof Error ? { reasons: [cause] } : {}),
    });
    this.name = "ExportFailedError";
  }
}

/**
 * No live auth session behind the request — a known cause the customer can act on (sign in again), which is exactly what the registry's `unauthorized` copy says, and a 401 rather than the generic string body this route used to hand-roll.
 */
export class ExportUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "No active session for this export request.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ExportUnauthenticatedError";
  }
}
