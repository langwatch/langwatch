import { context as otelContext, trace, isSpanContextValid } from "@opentelemetry/api";

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

// AsyncLocalStorage is only available in Node.js. In browser environments
// context propagation is a no-op (returns undefined / runs fn directly).
let asyncLocalStorage: import("node:async_hooks").AsyncLocalStorage<RequestContext> | null = null;

// INTENTIONAL dynamic require — exception to the no-dynamic-import rule.
// This package uses a single entry point for both browser and Node.js environments.
// async_hooks is Node-only and must be conditionally loaded at runtime; a static
// import would cause a hard failure in browser bundles.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  asyncLocalStorage = new AsyncLocalStorage<RequestContext>();
} catch {
  // Browser environment — no ALS available
}

/**
 * Gets the current business context from AsyncLocalStorage.
 */
export function getCurrentContext(): RequestContext | undefined {
  return asyncLocalStorage?.getStore();
}

/**
 * Runs a function within the context of a RequestContext.
 * The context will be available via getCurrentContext() within the function
 * and any async operations it spawns.
 *
 * In browser environments, runs `fn` directly (no context propagation).
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  if (!asyncLocalStorage) return fn();
  return asyncLocalStorage.run(ctx, fn);
}

/**
 * Updates the current context with additional fields.
 * Useful for setting user/project/org after authentication.
 */
export function updateCurrentContext(updates: Partial<RequestContext>): void {
  const current = asyncLocalStorage?.getStore();
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
  if (!span) return undefined;

  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return undefined;

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}
