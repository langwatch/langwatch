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
  runWithContext,
  updateCurrentContext,
  logHttpRequest,
  getStatusCodeFromError,
} from "@langwatch/telemetry";

// ---------------------------------------------------------------------------
// Tracer middleware
// ---------------------------------------------------------------------------

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined =>
    carrier.get(key) ?? void 0,
};

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
          try {
            const spanCtx = span.spanContext();
            c.set("traceId", spanCtx.traceId);
            c.set("spanId", spanCtx.spanId);

            await next();

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
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            const carrier: Record<string, string> = {};
            propagation.inject(otContext.active(), carrier);
            for (const [key, value] of Object.entries(carrier)) {
              try {
                c.res.headers.set(key, value);
              } catch {
                // ignore if response headers are not available
              }
            }
            span.end();
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
 * Creates a Hono middleware that logs each request using `@langwatch/telemetry`.
 *
 * Sets up async context propagation so that downstream code can access
 * org/project/user context via `getCurrentContext()`.
 */
export function loggerMiddleware(options?: { name?: string }) {
  const logger = createLogger(
    `langwatch:api:${options?.name ?? "hono"}`,
  );

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
        const duration = Date.now() - start;
        const statusCode = error
          ? getStatusCodeFromError(error)
          : c.res.status;

        logHttpRequest(logger, {
          method: c.req.method,
          url: c.req.url,
          statusCode,
          duration,
          userAgent: c.req.header("user-agent") ?? null,
          error: error || c.error,
        });
      }
    });
  };
}
