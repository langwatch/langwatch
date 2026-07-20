import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { Context, Next } from "hono";

import { getCurrentContext } from "../../../server/context/asyncContext";

type TracerOptions = {
  name?: string;
};

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined =>
    carrier.get(key) ?? void 0,
};

export const tracerMiddleware = (options?: TracerOptions) => {
  return async (c: Context, next: Next): Promise<any> => {
    // An existing async request context means an outer SecuredApp already
    // wrapped this request (the families sharing basePath "/api" all register
    // this middleware, and every one matches every /api request) — without
    // this guard a request gets one nested server span per family instead of
    // one span. The first family's tracer runs before any context exists, so
    // exactly one span is created; its logger then establishes the context
    // that makes every later invocation skip.
    if (getCurrentContext()) return next();

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
          // `service.name` is a resource attribute, set once at SDK init to
          // identify the process (`langwatch-app`). Setting it per span
          // overrode that identity with a route-family label, so the family
          // gets its own attribute instead.
          attributes: options?.name
            ? { "service.family": options.name }
            : void 0,
        },
        async (span) => {
          try {
            const spanCtx = span.spanContext();
            c.set("traceId", spanCtx.traceId);
            c.set("spanId", spanCtx.spanId);

            await next();

            // After handler, add context attributes to span if available
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
            // Inject trace context to response headers for outward propagation
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
};
