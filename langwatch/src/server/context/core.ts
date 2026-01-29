import { AsyncLocalStorage } from "node:async_hooks";
import { context as otContext, trace } from "@opentelemetry/api";

/**
 * Request context that can be propagated across async boundaries.
 * This enables correlation of logs and traces from HTTP requests through to background jobs.
 */
export interface RequestContext {
  traceId: string;
  spanId: string;
  organizationId?: string;
  projectId?: string;
  userId?: string;
}

/**
 * Job context metadata that is attached to job payloads for trace correlation.
 */
export interface JobContextMetadata {
  traceId?: string;
  parentSpanId?: string;
  organizationId?: string;
  projectId?: string;
  userId?: string;
}

// AsyncLocalStorage instance for propagating context across async boundaries
const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Gets the current request context from AsyncLocalStorage.
 * Falls back to extracting from OpenTelemetry if not in AsyncLocalStorage.
 */
export function getCurrentContext(): RequestContext | undefined {
  // First, try AsyncLocalStorage
  const alsContext = asyncLocalStorage.getStore();
  if (alsContext) {
    return alsContext;
  }

  // Fall back to extracting from OpenTelemetry
  const span = trace.getSpan(otContext.active());
  if (span) {
    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }

  return undefined;
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
export function updateCurrentContext(
  updates: Partial<Omit<RequestContext, "traceId" | "spanId">>,
): void {
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
 * Generates a 32-character hex string (128-bit trace ID).
 * Used when no OTel context is available.
 */
export function generateTraceId(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

/**
 * Generates a 16-character hex string (64-bit span ID).
 * Used when no OTel context is available.
 */
export function generateSpanId(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

/**
 * Gets the current OTel span context if available.
 * Returns undefined if no active span exists.
 */
export function getOtelSpanContext(): { traceId: string; spanId: string } | undefined {
  const span = trace.getSpan(otContext.active());
  if (span) {
    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }
  return undefined;
}
