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
import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { getServerAuthSession } from "~/server/auth";

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

export const app = new Hono().basePath("/api");

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
const handler = async (c: { req: { raw: Request } }) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: await getAppRouter(),
    createContext: async ({ req }: FetchCreateContextFnOptions) => {
      const reqShim = buildReqShim(req);

      const session = await getServerAuthSession({
        req: req as unknown as Parameters<typeof getServerAuthSession>[0]["req"],
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
};

app.get("/trpc/*", handler);
app.post("/trpc/*", handler);
