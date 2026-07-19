import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Context, Next } from "hono";
import {
  createLogger,
  logHttpRequest,
  getStatusCodeFromError,
} from "@langwatch/observability";
import {
  runWithContext,
  updateCurrentContext,
} from "@langwatch/observability/context";

import { getSSECompletion } from "./sse.js";

// ---------------------------------------------------------------------------
// Tracer middleware
// ---------------------------------------------------------------------------

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined =>
    carrier.get(key) ?? void 0,
};

function injectTraceHeaders(c: Context): void {
  const carrier: Record<string, string> = {};
  propagation.inject(otContext.active(), carrier);
  for (const [key, value] of Object.entries(carrier)) {
    try {
      c.res.headers.set(key, value);
    } catch {
      // ignore if response headers are not available
    }
  }
}

/**
 * Creates a Hono middleware that wraps each request in an OTel span.
 *
 * Sets `traceId` and `spanId` on the Hono context for downstream use.
 * After the handler runs, adds org/project/user attributes to the span.
 */
export function tracerMiddleware(options?: { name?: string }) {
  return async (c: Context, next: Next): Promise<void> => {
    const tracer = trace.getTracer("langwatch:api:hono");

    const incomingHeaders = c.req.raw.headers;
    const parentCtx = propagation.extract(
      otContext.active(),
      incomingHeaders,
      headersGetter,
    );

    const method = c.req.method;
    const spanName = `${method} ${options?.name ?? c.req.path}`;

    return otContext.with(parentCtx, async () => {
      return tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          attributes: options?.name
            ? { "service.name": options.name }
            : undefined,
        },
        async (span) => {
          let requestError: unknown;
          let isFinished = false;
          const finishSpan = () => {
            if (isFinished) return;
            isFinished = true;

            const organizationId = c.get("organization")?.id;
            const projectId = c.get("project")?.id;
            const userId = c.get("user")?.id;
            if (organizationId) {
              span.setAttribute("organization.id", organizationId);
            }
            if (projectId) {
              span.setAttribute("tenant.id", projectId);
            }
            if (userId) {
              span.setAttribute("user.id", userId);
            }

            const error = requestError ?? c.error;
            if (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
            }
            span.end();
          };

          try {
            const spanCtx = span.spanContext();
            c.set("traceId", spanCtx.traceId);
            c.set("spanId", spanCtx.spanId);

            await next();
          } catch (err) {
            requestError = err;
            throw err;
          } finally {
            injectTraceHeaders(c);
            runAfterSSECompletion({
              c,
              onSettled: finishSpan,
              onStreamError: (error) => {
                requestError = error;
              },
            });
          }
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------
// Logger middleware
// ---------------------------------------------------------------------------

/**
 * Creates a Hono middleware that logs each request using `@langwatch/observability`.
 *
 * Sets up async context propagation so that downstream code can access
 * org/project/user context via `getCurrentContext()`.
 */
export function loggerMiddleware(options?: { name?: string }) {
  const logger = createLogger(`langwatch:api:${options?.name ?? "hono"}`);

  return async (c: Context, next: Next): Promise<void> => {
    const ctx = {
      organizationId: c.get("organization")?.id,
      projectId: c.get("project")?.id,
      userId: c.get("user")?.id,
    };

    return runWithContext(ctx, async () => {
      const start = Date.now();
      let error: unknown = c.error;

      try {
        await next();

        // Update context after auth resolves org/project/user
        updateCurrentContext({
          organizationId: c.get("organization")?.id,
          projectId: c.get("project")?.id,
          userId: c.get("user")?.id,
        });
      } catch (err) {
        error = err;
        throw err;
      } finally {
        const logRequest = () => {
          const requestError = error || c.error;
          const duration = Date.now() - start;
          const statusCode = requestError
            ? getStatusCodeFromError(requestError)
            : c.res.status;

          logHttpRequest(logger, {
            method: c.req.method,
            url: c.req.path,
            statusCode,
            duration,
            userAgent: c.req.header("user-agent") ?? null,
            error: requestError,
          });
        };

        runAfterSSECompletion({
          c,
          onSettled: logRequest,
          onStreamError: (streamError) => {
            error = streamError;
          },
        });
      }
    });
  };
}

function runAfterSSECompletion({
  c,
  onSettled,
  onStreamError,
}: {
  c: Context;
  onSettled: () => void;
  onStreamError: (error: Error) => void;
}): void {
  const streamCompletion = getSSECompletion(c);
  if (!streamCompletion) {
    onSettled();
    return;
  }

  void streamCompletion
    .then(({ error }) => {
      try {
        if (error) onStreamError(error);
      } finally {
        onSettled();
      }
    })
    .catch(() => {
      // Instrumentation finalizers run after the response has started and must
      // never surface as an unhandled rejection in the application process.
    });
}
