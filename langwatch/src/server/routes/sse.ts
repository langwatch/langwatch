/**
 * Hono route for SSE (Server-Sent Events) tRPC subscriptions.
 *
 * Pure Hono app serving tRPC subscription procedures over SSE.
 *
 * The handler:
 * 1. Takes a tRPC procedure path from the URL (e.g. /api/sse/traces.onTraceUpdate)
 * 2. Parses input from query params using superjson
 * 3. Creates a tRPC context and calls the procedure
 * 4. Streams the result as Server-Sent Events
 * 5. Supports AsyncIterable and Observable patterns
 * 6. Sends keep-alive pings every 25 seconds
 * 7. Handles cleanup on client disconnect
 */

import superjson from "superjson";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";

// Lazy-load appRouter — same reason as trpc.ts (circular dependency avoidance)
let _appRouter: Awaited<typeof import("~/server/api/root")>["appRouter"] | null = null;
async function getAppRouter() {
  if (!_appRouter) {
    const mod = await import("~/server/api/root");
    _appRouter = mod.appRouter;
  }
  return _appRouter;
}

import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { HandledError } from "@langwatch/handled-error";
import { getServerAuthSession } from "~/server/auth";

const logger = createLogger("langwatch:sse");

/**
 * The SSE error frame. HTTP 200 is already on the wire when a stream fails, so
 * the handled shape has to ride inside the frame: a HandledError (directly, or
 * as a TRPCError cause) carries its full serialized domain error; a client-safe
 * TRPCError keeps its message; anything else degrades to the generic unknown
 * message — the raw detail stays server-side in the log (ADR-045).
 */
export function sseErrorFrame(err: unknown): Record<string, unknown> {
  const handled = handledCauseOf(err);
  if (handled) {
    return {
      type: "error",
      message: handled.message,
      domainError: handled.serialize(),
    };
  }
  if (err instanceof TRPCError && err.code !== "INTERNAL_SERVER_ERROR") {
    return { type: "error", message: err.message };
  }
  return { type: "error", message: "An unknown error occurred" };
}

/** The HandledError behind a stream failure, if there is one. */
function handledCauseOf(err: unknown): HandledError | undefined {
  const candidate = err instanceof TRPCError ? err.cause : err;
  if (candidate instanceof HandledError) return candidate;
  // A bundler can load a second copy of the package — duck-type like the
  // Hono error handler does (see error-handler.ts).
  if (
    candidate &&
    typeof candidate === "object" &&
    "code" in candidate &&
    "httpStatus" in candidate &&
    typeof (candidate as { serialize?: unknown }).serialize === "function"
  ) {
    return candidate as HandledError;
  }
  return undefined;
}

/**
 * Stream-failure logging, same fault-axis rule as the tRPC and Hono request
 * loggers: customer-fault handled errors warn (spike-watched), platform /
 * provider and unhandled errors log at error.
 */
function logSseError(err: unknown, logData: Record<string, unknown>, msg: string) {
  const handled = handledCauseOf(err);
  const level = handled && handled.fault === "customer" ? "warn" : "error";
  logger[level](
    {
      ...logData,
      ...(handled
        ? { handledErrorCode: handled.code, handledErrorFault: handled.fault }
        : {}),
    },
    msg,
  );
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

secured.access(
  handlerManagedAuth("user session validated in-handler via getServerAuthSession"),
).get("/sse/*", async (c) => {
  const raw = c.req.raw;
  const url = new URL(raw.url);

  // Extract the procedure path from the URL.
  // The URL path is /api/sse/traces.onTraceUpdate or /api/sse/traces/onTraceUpdate.
  // We strip the /api/sse/ prefix and join remaining segments with ".".
  const pathAfterSse = url.pathname.replace(/^\/api\/sse\/?/, "");
  const path = pathAfterSse.replace(/\//g, ".");

  if (!path) {
    return c.json({ message: "Missing trpc path" }, 400);
  }

  // Parse input from query params
  const inputParam = url.searchParams.get("input") ?? undefined;
  const input = inputParam ? superjson.parse(inputParam) : undefined;

  // Build context
  const reqShim = buildReqShim(raw);
  const session = await getServerAuthSession({
    req: raw as unknown as Parameters<typeof getServerAuthSession>[0]["req"],
  });
  const ctx = createInnerTRPCContext({
    req: reqShim,
    res: undefined,
    session,
    permissionChecked: false,
    publiclyShared: false,
  });

  // Create caller and resolve the procedure
  const router = await getAppRouter();
  const caller = router.createCaller(ctx);
  const procedure = path
    .split(".")
    .reduce<any>((obj, key) => obj?.[key], caller);

  if (typeof procedure !== "function") {
    return c.json({ message: "Procedure not found" }, 404);
  }

  // Set SSE headers
  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let ended = false;
      let unsubscribe: (() => void) | null = null;

      const write = (text: string) => {
        if (ended) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Stream already closed
          end();
        }
      };

      const writeData = (value: unknown) => {
        if (ended) return;
        const payload = superjson.stringify(value);
        for (const line of payload.split(/\r?\n/)) {
          write(`data: ${line}\n`);
        }
        write("\n");
      };

      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(ping);
        try {
          unsubscribe?.();
        } catch {
          // Ignore cleanup errors
        }
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      // Keep-alive ping every 25 seconds
      const ping = setInterval(() => {
        if (ended) {
          end();
        } else {
          write(": ping\n\n");
        }
      }, 25_000);

      // Send connected event
      writeData({ type: "connected" });

      // Call the procedure and handle the result
      (async () => {
        try {
          const result = await procedure(input);

          // AsyncIterable
          if (result && typeof result[Symbol.asyncIterator] === "function") {
            for await (const data of result as AsyncIterable<unknown>) {
              if (ended) break;
              writeData(data);
            }
            writeData({ type: "complete" });
            end();
            return;
          }

          // Observable-like (tRPC subscriptions)
          if (result && typeof (result as any).subscribe === "function") {
            const sub = (result as any).subscribe({
              next: (data: unknown) => writeData(data),
              complete: () => {
                writeData({ type: "complete" });
                end();
              },
              error: (err: unknown) => {
                logSseError(err, { err, path }, "SSE observable error");
                writeData(sseErrorFrame(err));
                end();
              },
            });

            if (typeof sub === "function") unsubscribe = sub;
            else if (sub && typeof sub.unsubscribe === "function")
              unsubscribe = () => sub.unsubscribe();

            return; // Keep connection open for observable
          }

          // Non-streaming result
          writeData(result);
          writeData({ type: "complete" });
          end();
        } catch (error) {
          logSseError(error, { error, path, input }, "SSE handler error");
          writeData(sseErrorFrame(error));
          end();
        }
      })();

      // Handle client disconnect via AbortSignal on the request
      raw.signal?.addEventListener("abort", () => {
        end();
      });
    },
  });

  return new Response(body, {
    status: 200,
    headers: c.res.headers,
  });
});

export const app = secured.hono;
