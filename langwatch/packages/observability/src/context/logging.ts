import { context as otelContext, trace } from "@opentelemetry/api";
import { getCurrentContext } from "./core";

/**
 * Gets context fields suitable for logging.
 * Trace/span come directly from OTel context.
 * Business context (org/project/user) comes from our AsyncLocalStorage.
 */
export function getLogContext(): Record<string, string | null> {
  // Get trace/span directly from OTel - this is the source of truth
  const span = trace.getSpan(otelContext.active());
  const spanContext = span?.spanContext();

  // Get business context from our ALS
  const ctx = getCurrentContext();

  return {
    traceId: spanContext?.traceId ?? null,
    spanId: spanContext?.spanId ?? null,
    organizationId: ctx?.organizationId ?? null,
    projectId: ctx?.projectId ?? null,
    userId: ctx?.userId ?? null,
  };
}
