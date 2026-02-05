import { context as otelContext, trace } from "@opentelemetry/api";
import { getCurrentContext } from "./core";

/**
 * Gets context fields suitable for logging.
 * Trace/span come directly from OTel context.
 * Business context (org/project/user) comes from our AsyncLocalStorage.
 */
export function getLogContext(): Record<string, string | undefined> {
  // Get trace/span directly from OTel - this is the source of truth
  const span = trace.getSpan(otelContext.active());
  const spanContext = span?.spanContext();

  // Get business context from our ALS
  const ctx = getCurrentContext();

  return {
    traceId: spanContext?.traceId ?? void 0,
    spanId: spanContext?.spanId ?? void 0,
    organizationId: ctx?.organizationId ?? void 0,
    projectId: ctx?.projectId ?? void 0,
    userId: ctx?.userId ?? void 0,
  };
}
