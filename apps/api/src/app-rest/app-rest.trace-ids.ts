import { INVALID_TRACE_ID } from "@langwatch/observability/constants";
import type { Context } from "hono";

/**
 * The correlation handles the process's tracer middleware put on the request.
 *
 * Every canonical refusal carries them, because the body of a 5xx deliberately
 * says nothing about the failure: quoting a trace id is what connects a
 * customer's report to the log line that holds the detail. Reading them lives
 * beside the secured-app builder rather than in the application, so a REST
 * family packaged here renders the same envelope as one still mounted from the
 * application.
 */
const INVALID_SPAN_ID = "0".repeat(16);

/** An all-zero id is OpenTelemetry's "no valid span" sentinel: treat as absent. */
function liveId(id: unknown, zero: string): string | undefined {
  return typeof id === "string" && id && id !== zero ? id : undefined;
}

/** The request's trace correlation handles, as set by the tracer middleware. */
export function requestTraceIds(c: Context): {
  traceId?: string;
  spanId?: string;
} {
  return {
    traceId: liveId(c.get("traceId"), INVALID_TRACE_ID),
    spanId: liveId(c.get("spanId"), INVALID_SPAN_ID),
  };
}
