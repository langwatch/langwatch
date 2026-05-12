import { AsyncLocalStorage } from "node:async_hooks";
import { context as otelContext, trace } from "@opentelemetry/api";

/**
 * Business context that can be propagated across async boundaries.
 * Used for logging correlation (org/project/user).
 *
 * Note: Trace/span IDs come directly from OTel context, not stored here.
 */
export interface RequestContext {
  organizationId?: string;
  projectId?: string;
  userId?: string;
}

/**
 * Context metadata attached to job payloads for propagation.
 * - Trace/span IDs: For OTel span linking (linking job spans to originating request)
 * - Business context: For logging correlation
 */
export interface JobContextMetadata {
  traceId?: string;
  parentSpanId?: string;
  organizationId?: string;
  projectId?: string;
  userId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Gets the current business context from AsyncLocalStorage.
 */
export function getCurrentContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Runs a function within the context of a RequestContext.
 * The context will be available via getCurrentContext() within the function
 * and any async operations it spawns.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}

/**
 * Updates the current context with additional fields.
 * Useful for setting user/project/org after authentication.
 */
export function updateCurrentContext(updates: Partial<RequestContext>): void {
  const current = asyncLocalStorage.getStore();
  if (current) {
    if (updates.organizationId !== undefined) {
      current.organizationId = updates.organizationId;
    }
    if (updates.projectId !== undefined) {
      current.projectId = updates.projectId;
    }
    if (updates.userId !== undefined) {
      current.userId = updates.userId;
    }
  }
}

/**
 * Gets the current OTel span context if available.
 * Used for propagating trace context to job payloads for span linking.
 */
export function getOtelSpanContext(): { traceId: string; spanId: string } | undefined {
  const span = trace.getSpan(otelContext.active());
  if (span) {
    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }
  return undefined;
}

