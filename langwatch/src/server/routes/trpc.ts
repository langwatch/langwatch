/**
 * Hono route for tRPC.
 *
 * Replaces the Next.js Pages Router handler at src/pages/api/trpc/[trpc].ts
 * with a pure Hono app using the tRPC fetch adapter (web-standard
 * Request/Response).
 *
 * Handles both GET (queries) and POST (mutations), including batched
 * requests where procedure names are comma-separated in the path.
 */

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context } from "hono";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { getServerAuthSession } from "~/server/auth";

/**
 * JSON-RPC 2.0 internal-error code. tRPC maps the `INTERNAL_SERVER_ERROR`
 * procedure code onto this numeric code on the wire, so we reuse it here for
 * the synthetic envelope below.
 */
const JSONRPC_INTERNAL_ERROR = -32603;

/**
 * Build a tRPC-shaped error envelope for an exception that escaped
 * `fetchRequestHandler` (e.g. a throw inside `createContext`, or a synchronous
 * throw such as the ClickHouse "client not available" guard) BEFORE tRPC could
 * serialize its own error body.
 *
 * Why this exact shape: the response body MUST be non-empty parseable JSON, or
 * the client's `response.json()` throws `Unexpected end of JSON input` (the
 * langwatch#5219 crash). Returning the tRPC single-procedure error envelope —
 * `{ error: { json: { message, code, data } } }`, where the `json` key is the
 * superjson wrapper this app's transformer expects — lets the tRPC client's
 * `transformResult` read `.error` and surface a proper `TRPCClientError`
 * instead of a generic parse failure.
 *
 * @see src/server/api/trpc.ts — `transformer: superjson`, `errorFormatter`
 * @see langwatch#5219
 */
function trpcErrorEnvelope(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Internal server error";

  return {
    error: {
      json: {
        message,
        code: JSONRPC_INTERNAL_ERROR,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
        },
      },
    },
  };
}

// Lazy-load appRouter to avoid circular dependency issues at startup.
// The tRPC router imports templates that import UI components (DatasetTable etc.)
// which cause "Cannot access before initialization" errors in Node/tsx.
let _appRouter: Awaited<typeof import("~/server/api/root")>["appRouter"] | null = null;
async function getAppRouter() {
  if (!_appRouter) {
    const mod = await import("~/server/api/root");
    _appRouter = mod.appRouter;
  }
  return _appRouter;
}

const secured = createServiceApp({ basePath: "/api" });

/**
 * Build a minimal NextApiRequest-shaped shim from a web Request.
 *
 * Several tRPC middlewares (auditLog, loggerMiddleware) read
 * `ctx.req.headers[...]` and `ctx.req.socket.remoteAddress`. We expose
 * just enough surface area for those consumers to work without pulling in
 * a real Node IncomingMessage.
 */
function buildReqShim(req: Request): any {
  const url = new URL(req.url);

  // Convert web Headers to the Node-style { [key]: string | string[] } map
  const headers: Record<string, string | string[]> = {};
  req.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing) {
      headers[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      headers[key] = value;
    }
  });

  return {
    headers,
    method: req.method,
    url: url.pathname + url.search,
    query: Object.fromEntries(url.searchParams),
    socket: { remoteAddress: undefined },
  } as any;
}

/**
 * Single handler for both GET and POST. The tRPC fetch adapter
 * internally dispatches based on HTTP method (GET → query, POST → mutation).
 *
 * The route pattern "/trpc/:trpc" captures single procedure names.
 * Batched requests use comma-separated names (e.g. "foo,bar") which the
 * tRPC client sends as a single path segment, so the same pattern works.
 */
const handler = async (c: Context) => {
  // tRPC's fetch adapter serializes procedure-level errors into a JSON error
  // body itself. But an exception that escapes the adapter entirely — a throw
  // in `createContext`, or a synchronous throw like the ClickHouse "client not
  // available" guard — bypasses that serialization. If it propagated, the
  // route would emit a 0-byte body (see `routeThroughHono` in src/start.ts),
  // and the client's `response.json()` would throw `Unexpected end of JSON
  // input`. Catch it here and return a well-formed tRPC error envelope so the
  // route NEVER yields an empty body. @see langwatch#5219
  try {
    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: await getAppRouter(),
      createContext: async ({ req }: FetchCreateContextFnOptions) => {
        const reqShim = buildReqShim(req);

        const session = await getServerAuthSession({
          req: req as unknown as Parameters<
            typeof getServerAuthSession
          >[0]["req"],
        });

        return createInnerTRPCContext({
          req: reqShim,
          res: undefined,
          session,
          permissionChecked: false,
          publiclyShared: false,
        });
      },
    });
  } catch (error) {
    return c.json(trpcErrorEnvelope(error), 500);
  }
};

secured.access(
  handlerManagedAuth("tRPC enforces per-procedure RBAC internally"),
).get("/trpc/*", handler);
secured.access(
  handlerManagedAuth("tRPC enforces per-procedure RBAC internally"),
).post("/trpc/*", handler);

export const app = secured.hono;
