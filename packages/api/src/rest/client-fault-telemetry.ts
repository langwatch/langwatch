/**
 * How a REST request that failed through the caller's fault is reported: a span left UNSET with
 * its exception kept, one counter series per reason, and a request log line sampled per reason.
 * A server fault keeps the loud treatment, now with the cause on the span status. Mirrors the
 * tRPC lane (trpc/policy.ts), which has always left customer faults off the error SLOs.
 */
import { HandledError } from "@langwatch/handled-error";
import { createWarnThrottle, getStatusCodeFromError } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
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

/** The reason code of an error answered below 500, whatever its shape. */
function clientFaultCodeOf(error: unknown): string | undefined {
  if (HandledError.isHandled(error)) return error.fault === "customer" ? error.code : undefined;
  const status = getStatusCodeFromError(error);
  if (error && status >= 400 && status < 500) return `http_${status}`;
  return undefined;
}

/** Whether the failure is the caller's to fix, so it is not a server error. */
export function isClientFault(error: unknown): boolean {
  return clientFaultCodeOf(error) !== undefined;
}

/**
 * Records a failed request on its span. The exception event is always kept. A client fault
 * leaves the status UNSET; anything else is ERROR carrying the cause in `status.message`.
 */
export function recordRequestSpanFailure({ span, error }: { span: Span; error: unknown }): void {
  span.recordException(error as Error);

  const code = clientFaultCodeOf(error);
  if (code !== undefined) {
    span.setAttributes({ "langwatch.error.code": code, "langwatch.error.fault": "customer" });
    return;
  }

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  span.setStatus({ code: SpanStatusCode.ERROR, ...(message ? { message } : {}) });
}

/**
 * Counts a client-fault request and decides how loudly its log line speaks: the first of a
 * reason in a window warns (carrying how many repeats were held back); the repeats go to debug.
 * Undefined means the error is not a client fault and the caller logs as it always did.
 */
export function sampleClientFaultLog({
  error,
  family,
  statusCode,
  now = Date.now(),
}: {
  error: unknown;
  family: string | undefined;
  statusCode: number;
  now?: number;
}): { level: "warn" | "debug"; suppressedRequests: number } | undefined {
  const code = clientFaultCodeOf(error);
  if (code === undefined) return undefined;

  clientFaultRequestsTotal.inc({ family: family ?? "unknown", code, status: statusCode });

  const suppressed = clientFaultLog.claim({ key: `${family ?? ""}|${code}|${statusCode}`, now });
  return suppressed === undefined
    ? { level: "debug", suppressedRequests: 0 }
    : { level: "warn", suppressedRequests: suppressed };
}

/** Clears the sampled-log state; tests only. */
export function resetClientFaultLog(): void {
  clientFaultLog.reset();
}
