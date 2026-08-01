import { HandledError } from "@langwatch/handled-error";

/**
 * The export could not be produced.
 *
 * Raised when an export fails to START — the service could not be built, or the
 * count query that sizes it blew up — and the underlying failure has nothing
 * handled to say for itself. Before this, that path answered
 * `{ error: "Internal server error" }`, which the browser read as an unhandled
 * failure and reported as "Something went wrong. We've been notified." — true,
 * but it never told the user the one thing that matters here: nothing was
 * changed, so trying again (or exporting a smaller slice) is safe.
 *
 * Deliberately NOT a wrapper for every infra fault. A failure that is ALREADY
 * handled — `query_timeout`, `clickhouse_unavailable`, `time_range_too_wide` —
 * says something more specific than this does and travels on its own; dressing
 * it up as an export failure would hide the sentence that actually helps. The
 * unhandled cause rides the reason chain instead, so the log line keeps it
 * while the customer gets copy written for them.
 *
 * `fault: platform` explicitly. This is a 5xx, and the default is `customer`,
 * so an unannotated one would log a real incident as routine noise.
 *
 * The words live in the presentation registry under `export_failed`.
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
 * No live auth session behind the request.
 *
 * A known cause the customer can act on — sign in again — which is exactly what
 * the registry's `unauthorized` copy says, and a 401 rather than the generic
 * string body this route used to hand-roll.
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
