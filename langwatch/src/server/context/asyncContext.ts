import { AsyncLocalStorage } from "node:async_hooks";
import { context as otContext, trace } from "@opentelemetry/api";
import type { Context as HonoContext } from "hono";
import type { NextRequest } from "next/server";
import type { NextApiRequest } from "next";
import { registerContextProvider } from "./contextProvider";

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
 * Creates a RequestContext from a Hono context.
 * Extracts user, project, and organization from Hono's context store.
 */
export function createContextFromHono(c: HonoContext): RequestContext {
  const span = trace.getSpan(otContext.active());
  const spanContext = span?.spanContext();

  return {
    traceId: c.get("traceId") ?? spanContext?.traceId ?? generateTraceId(),
    spanId: c.get("spanId") ?? spanContext?.spanId ?? generateSpanId(),
    organizationId: c.get("organization")?.id,
    projectId: c.get("project")?.id,
    userId: c.get("user")?.id,
  };
}

/**
 * Creates a RequestContext from tRPC context and input.
 * Extracts user from session, project/org from input.
 */
export function createContextFromTRPC(
  ctx: {
    session?: { user?: { id?: string } } | null;
  },
  input?: { projectId?: string; organizationId?: string },
): RequestContext {
  const span = trace.getSpan(otContext.active());
  const spanContext = span?.spanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    organizationId: input?.organizationId,
    projectId: input?.projectId,
    userId: ctx.session?.user?.id,
  };
}

/**
 * Creates a RequestContext from a Next.js App Router request.
 */
export function createContextFromNextRequest(req: NextRequest): RequestContext {
  const span = trace.getSpan(otContext.active());
  const spanContext = span?.spanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    // App Router middleware doesn't have access to session/user context
    // Those need to be populated by route handlers
  };
}

/**
 * Creates a RequestContext from a Next.js Pages Router request.
 */
export function createContextFromNextApiRequest(
  req: NextApiRequest,
): RequestContext {
  const span = trace.getSpan(otContext.active());
  const spanContext = span?.spanContext();

  return {
    traceId: spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    // Pages Router middleware doesn't have access to session/user context
    // Those need to be populated by route handlers
  };
}

/**
 * Creates a RequestContext from job metadata.
 * Used when processing background jobs to restore the context from the originating request.
 */
export function createContextFromJobData(
  metadata?: JobContextMetadata,
): RequestContext {
  const span = trace.getSpan(otContext.active());
  const spanContext = span?.spanContext();

  return {
    // Use metadata trace/span if available, otherwise fall back to current span
    traceId: metadata?.traceId ?? spanContext?.traceId ?? generateTraceId(),
    spanId: spanContext?.spanId ?? generateSpanId(),
    organizationId: metadata?.organizationId,
    projectId: metadata?.projectId,
    userId: metadata?.userId,
  };
}

/**
 * Gets context fields suitable for logging.
 * Always returns an object (never undefined) so it can be spread into log data.
 */
export function getLogContext(): Record<string, string | null> {
  const ctx = getCurrentContext();

  return {
    traceId: ctx?.traceId ?? null,
    spanId: ctx?.spanId ?? null,
    organizationId: ctx?.organizationId ?? null,
    projectId: ctx?.projectId ?? null,
    userId: ctx?.userId ?? null,
  };
}

/**
 * Extracts job context metadata from the current context.
 * This should be attached to job payloads when sending to queues.
 */
export function getJobContextMetadata(): JobContextMetadata {
  const ctx = getCurrentContext();

  return {
    traceId: ctx?.traceId,
    parentSpanId: ctx?.spanId,
    organizationId: ctx?.organizationId,
    projectId: ctx?.projectId,
    userId: ctx?.userId,
  };
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

// Helper functions for generating trace/span IDs when none are available
function generateTraceId(): string {
  // Generate a 32-character hex string (128-bit trace ID)
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function generateSpanId(): string {
  // Generate a 16-character hex string (64-bit span ID)
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

// Register the context provider for the logger to use
// This must be done at module load time to ensure it's available
registerContextProvider(getLogContext);
