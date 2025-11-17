import type { Context, Next } from "hono";
import { context as otContext, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

type TracerOptions = {
  name?: string;
};

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined => carrier.get(key) ?? void 0,
};

export const tracerMiddleware = (options?: TracerOptions) => {
  return async (c: Context, next: Next): Promise<any> => {
    const tracer = trace.getTracer("langwatch:api:hono");

    const incomingHeaders = c.req.raw.headers;
    const parentCtx = propagation.extract(otContext.active(), incomingHeaders, headersGetter);

    const method = c.req.method;
    const spanName = `${method} ${options?.name ?? c.req.path}`;

    return otContext.with(parentCtx, async () => {
      return tracer.startActiveSpan(
        spanName,
        {
          kind: SpanKind.SERVER,
          attributes: options?.name ? { "langwatch.embedded-service.name": options.name } : void 0,
        },
        async (span) => {
          try {
            const spanCtx = span.spanContext();
            c.set("traceId", spanCtx.traceId);
            c.set("spanId", spanCtx.spanId);

            await next();
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
        }
      );
    });
  };
};
