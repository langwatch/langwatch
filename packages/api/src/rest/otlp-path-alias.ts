/**
 * A misconfigured OTLP exporter path, rewritten onto the canonical `/api/otel/v1/<signal>` before
 * any route matches, as main's otel-path-aliases.ts does: only the canonical routes are declared,
 * so an unknown base is a plain 404. See specs/otlp/endpoint-path-canonicalisation.feature.
 */
import { canonicalOtlpPath, stampCorrectedPath } from "@langwatch/observability";
import type { Hono } from "hono";

/** The request onto its canonical OTLP path, the original stamped in a header; else itself. */
export function canonicalOtlpRequest(request: Request): Request {
  const url = new URL(request.url);
  const originalPath = url.pathname;
  const canonical = canonicalOtlpPath(originalPath);
  if (!canonical || canonical === originalPath) return request;

  url.pathname = canonical;
  const rewritten = new Request(url, request);
  stampCorrectedPath({ headers: rewritten.headers, originalPath });

  return rewritten;
}

/** Replays an aliased OTLP request through `app` itself, so it reaches the canonical route. */
export function withOtlpPathAliases(app: Hono): Hono {
  app.use("*", async (context, next) => {
    const request = canonicalOtlpRequest(context.req.raw);
    if (request === context.req.raw) return next();

    return app.fetch(request, context.env);
  });

  return app;
}
