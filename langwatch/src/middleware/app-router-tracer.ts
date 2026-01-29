import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { NextRequest, NextResponse } from "next/server";
import { getCurrentContext } from "../server/context/asyncContext";

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined =>
    carrier.get(key) ?? void 0,
};

export function withAppRouterTracer(name?: string) {
  return (handler: (req: NextRequest) => Promise<NextResponse>) => {
    return async (req: NextRequest) => {
      const parentCtx = propagation.extract(
        otContext.active(),
        req.headers,
        headersGetter,
      );
      const spanName = `${req.method} ${name ?? req.nextUrl.pathname}`;
      const tracer = trace.getTracer("langwatch:next:app");

      return otContext.with(parentCtx, async () => {
        return tracer.startActiveSpan(
          spanName,
          {
            kind: SpanKind.SERVER,
            attributes: name ? { "service.name": name } : void 0,
          },
          async (span) => {
            let response: NextResponse | null = null;
            try {
              response = await handler(req);

              // Add context attributes to span if available from AsyncLocalStorage
              const ctx = getCurrentContext();
              if (ctx?.organizationId) {
                span.setAttribute("organization.id", ctx.organizationId);
              }
              if (ctx?.projectId) {
                span.setAttribute("tenant.id", ctx.projectId);
              }
              if (ctx?.userId) {
                span.setAttribute("user.id", ctx.userId);
              }
            } catch (err) {
              span.recordException(err as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            } finally {
              if (response) {
                const carrier: Record<string, string> = {};
                propagation.inject(otContext.active(), carrier);
                for (const [key, value] of Object.entries(carrier)) {
                  try {
                    response.headers.set(key, value);
                  } catch {
                    // ignore if response headers are not writable
                  }
                }
              }
              span.end();
            }

            return response;
          },
        );
      });
    };
  };
}
