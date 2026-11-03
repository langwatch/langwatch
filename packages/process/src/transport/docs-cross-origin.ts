/**
 * Cross-origin REST for the documentation playground (ADR-185): a registered docs origin may call
 * the REST families with a docs session key in `X-Auth-Token`. Exact origins only, never
 * credentials, and never the session-cookie lanes (tRPC, SSE, `/api/auth`).
 */
import { TrpcHost } from "@langwatch/api/trpc";
import type { MiddlewareHandler } from "hono";

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";
/* Authorization for the bearer schemes a pasted key uses; Idempotency-Key is a declared header. */
const ALLOWED_HEADERS = "X-Auth-Token, Authorization, Content-Type, Idempotency-Key";
const PREFLIGHT_MAX_AGE_SECONDS = "600";
const SESSION_LANES = [TrpcHost.path, TrpcHost.streamPath, "/api/auth"] as const;

function isSessionLane(path: string): boolean {
  return SESSION_LANES.some((lane) => path === lane || path.startsWith(`${lane}/`));
}

/** Answers a registered origin's preflight and marks its responses readable; others get nothing. */
export function docsCrossOrigin({ origins }: { origins: readonly string[] }): MiddlewareHandler {
  const registered = new Set(origins);

  return async (context, next) => {
    const origin = context.req.header("origin");
    if (origin === undefined || isSessionLane(context.req.path)) return next();
    const allowed = registered.has(origin);

    if (
      allowed &&
      context.req.method === "OPTIONS" &&
      context.req.header("access-control-request-method")
    ) {
      return context.body(null, 204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": PREFLIGHT_MAX_AGE_SECONDS,
        Vary: "Origin",
      });
    }

    await next();
    context.res.headers.append("Vary", "Origin");
    if (allowed) context.res.headers.set("Access-Control-Allow-Origin", origin);
  };
}
