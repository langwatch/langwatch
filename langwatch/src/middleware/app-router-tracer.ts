import { type NextRequest, type NextResponse } from "next/server";
import { context as otContext, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

const headersGetter = {
  keys: (carrier: Headers): string[] => Array.from(carrier.keys()),
  get: (carrier: Headers, key: string): string | string[] | undefined => carrier.get(key) ?? void 0,
};

export function withAppRouterTracer(name?: string) {
  return (handler: (req: NextRequest) => Promise<NextResponse>) => {
    return async (req: NextRequest) => {
      const parentCtx = propagation.extract(otContext.active(), req.headers, headersGetter);
      const spanName = `${req.method} ${name ?? req.nextUrl.pathname}`;
      const tracer = trace.getTracer("langwatch:next:app");

      return otContext.with(parentCtx, async () => {
        return tracer.startActiveSpan(
          spanName,
          { kind: SpanKind.SERVER, attributes: name ? { "langwatch.embedded-service.name": name } : void 0 },
          async (span) => {
            let response: NextResponse | null = null;
            try {
              response = await handler(req);
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
          }
        );
      });
    };
  };
}
