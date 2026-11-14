/**
 * A REST request failed through the caller's fault: span left UNSET with its exception, one counter
 * series per reason, a log line sampled per reason. A server fault stays loud, its cause on the
 * span status. Mirrors trpc/policy.ts. specs/observability/client-fault-telemetry.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { createWarnThrottle, getStatusCodeFromError } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";
import { type Span, SpanStatusCode } from "@opentelemetry/api";

/** Customer-fault requests per family, reason code and status. No tenant, key or token. */
const clientFaultRequestsTotal = counter({
  name: "langwatch_http_client_fault_requests_total",
  description:
    "REST requests that failed through the caller's fault, by family, reason code and status.",
});

/** One warn per family, reason and status per window; the counter above holds the full volume. */
const CLIENT_FAULT_LOG_WINDOW_MS = 60_000;
const clientFaultLog = createWarnThrottle(CLIENT_FAULT_LOG_WINDOW_MS);

/**
 * The reason code of a caller's fault, whatever its shape. Anything answered 500 or above is a
 * server error, even a customer-fault class or a thrown 4xx the error handler answered as a 500.
 */
function clientFaultCodeOf(error: unknown, answeredStatus?: number): string | undefined {
  if (answeredStatus !== undefined && answeredStatus >= 500) return undefined;
  if (HandledError.isHandled(error)) return error.fault === "customer" ? error.code : undefined;
  const status = getStatusCodeFromError(error);
  if (status >= 500) return undefined;
  return status >= 400 && status < 500 ? `http_${status}` : undefined;
}

/**
 * Records a failed request on its span. The exception event is always kept. A client fault
 * leaves the status UNSET; anything else is ERROR carrying the cause in `status.message`.
 */
export function recordRequestSpanFailure({
  span,
  error,
  answeredStatus,
}: {
  span: Pick<Span, "recordException" | "setAttributes" | "setStatus">;
  error: unknown;
  answeredStatus?: number;
}): void {
  span.recordException(error instanceof Error ? error : String(error));

  const code = clientFaultCodeOf(error, answeredStatus);
  if (code !== undefined) {
    span.setAttributes({ "langwatch.error.code": code, "langwatch.error.fault": "customer" });
    return;
  }

  const message = failureMessage(error);
  span.setStatus({ code: SpanStatusCode.ERROR, ...(message ? { message } : {}) });
}

/** The cause written on an ERROR span's status: the message, or nothing when there is none. */
function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/**
 * Counts a client-fault request and says whether its log line is a repeat: the first of a reason
 * in a window keeps its level and carries how many repeats were held back; the repeats go to
 * debug. Undefined means the error is not a client fault and the caller logs as it always did.
 */
export function sampleClientFaultLog({
  error,
  family,
  statusCode,
  now = nowInstant().epochMilliseconds,
}: {
  error: unknown;
  family: string | undefined;
  statusCode: number;
  now?: number;
}): { isRepeat: boolean; suppressedRequests: number } | undefined {
  const code = clientFaultCodeOf(error, statusCode);
  if (code === undefined) return undefined;

  clientFaultRequestsTotal.inc({ family: family ?? "unknown", code, status: statusCode });

  const suppressed = clientFaultLog.claim({ key: `${family ?? ""}|${code}|${statusCode}`, now });
  return suppressed === undefined
    ? { isRepeat: true, suppressedRequests: 0 }
    : { isRepeat: false, suppressedRequests: suppressed };
}

/** Clears the sampled-log state; tests only. */
export function resetClientFaultLog(): void {
  clientFaultLog.reset();
}
