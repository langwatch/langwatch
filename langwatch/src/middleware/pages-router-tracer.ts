import {
  context as otContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { NextApiRequest, NextApiResponse } from "next";
import { getCurrentContext } from "../server/context/asyncContext";

const headersGetter = {
  keys: (carrier: Record<string, unknown>): string[] => Object.keys(carrier),
  get: (
    carrier: Record<string, unknown>,
    key: string,
  ): string | string[] | undefined => {
    const value = carrier[key.toLowerCase()];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === "string") return value;
    return undefined;
  },
};

export function withPagesRouterTracer(name?: string) {
  return (
    handler: (
      req: NextApiRequest,
      res: NextApiResponse,
    ) => Promise<void | NextApiResponse>,
  ) => {
    return async (req: NextApiRequest, res: NextApiResponse) => {
      const parentCtx = propagation.extract(
        otContext.active(),
        req.headers,
        headersGetter,
      );
      const method = req.method ?? "UNKNOWN";
      const spanName = `${method} ${name ?? req.url ?? ""}`;
      const tracer = trace.getTracer("langwatch:next:pages");

      return otContext.with(parentCtx, async () => {
        return tracer.startActiveSpan(
          spanName,
          {
            kind: SpanKind.SERVER,
            attributes: name ? { "service.name": name } : void 0,
          },
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
              span.end();
            }
          },
        );
      });
    };
  };
}
