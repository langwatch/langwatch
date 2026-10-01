import { HandledError } from "@langwatch/handled-error";

/**
 * Export failed to start (service build failed or sizing query failed). Not a
 * wrapper for all infra faults: handled failures like `query_timeout` travel alone.
 * `fault: platform` explicit since this is a 5xx that would otherwise be routine noise.
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
 * The export door answered this project too often, or every in-flight slot is
 * held. `fault` stays customer: the rate and the concurrency are the caller's
 * own plan's, and the retry-after is theirs to wait out.
 */
export class TraceExportRateLimitedError extends HandledError {
  declare readonly code: "trace_export_rate_limited";

  constructor(input: { reason: "rate" | "concurrency"; retryAfterSeconds?: number | undefined }) {
    super(
      "trace_export_rate_limited",
      input.reason === "rate"
        ? "Too many trace exports started in the last minute"
        : "Too many trace exports already running for this project",
      {
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        ...(input.retryAfterSeconds !== undefined
          ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
          : {}),
      },
    );
    this.name = "TraceExportRateLimitedError";
  }
}

/**
 * No active auth session. Known cause the customer can act on (sign in again).
 * 401 status with registry-keyed copy (`unauthorized`).
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
