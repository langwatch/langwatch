import { type NextApiRequest, type NextApiResponse } from "next";
import { context as otContext, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

const headersGetter = {
  keys: (carrier: Record<string, unknown>): string[] => Object.keys(carrier),
  get: (carrier: Record<string, unknown>, key: string): string | string[] | undefined => {
    const value = carrier[key.toLowerCase()];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === "string") return value ;
    return undefined;
  },
};

export function withPagesRouterTracer(
  name?: string
) {
  return (
    handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>
  ) => {
    return async (req: NextApiRequest, res: NextApiResponse) => {
      const parentCtx = propagation.extract(otContext.active(), req.headers, headersGetter);
      const method = req.method ?? "UNKNOWN";
      const spanName = `${method} ${name ?? (req.url ?? "")}`;
      const tracer = trace.getTracer("langwatch:next:pages");

      return otContext.with(parentCtx, async () => {
        return tracer.startActiveSpan(
          spanName,
          { kind: SpanKind.SERVER, attributes: name ? { "langwatch.embedded-service.name": name } : void 0 },
          async (span) => {
            const carrier: Record<string, string> = {};
            propagation.inject(otContext.active(), carrier);
            for (const [key, value] of Object.entries(carrier)) {
              try {
                res.setHeader(key, value);
              } catch {
                // ignore if headers cannot be set
              }
            }

            try {
              await handler(req, res);
            } catch (err) {
              span.recordException(err as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw err;
            } finally {
              span.end();
            }
          }
        );
      });
    };
  };
}
