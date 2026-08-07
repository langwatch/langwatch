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
let _appRouter:
  | Awaited<typeof import("~/server/api/root")>["appRouter"]
  | null = null;
async function getAppRouter() {
  if (!_appRouter) {
    const mod = await import("~/server/api/root");
    _appRouter = mod.appRouter;
  }
  return _appRouter;
}

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { createInnerTRPCContext } from "~/server/api/trpc";
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
      // The code, never the handled error's own message — that is server copy
      // and can name internal configuration (ADR-045). The client keys its
      // presentation off `error.code` via the explainers.
      message: handled.code,
      error: handled.serialize(),
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
  // isHandled also matches an instance from a second copy of the package,
  // which bare `instanceof` misses — see its brand check.
  return HandledError.isHandled(candidate) ? candidate : undefined;
}

/**
 * Stream-failure logging, same fault-axis rule as the tRPC and Hono request
 * loggers: customer-fault handled errors warn (spike-watched), platform /
 * provider and unhandled errors log at error.
 */
function logSseError(
  err: unknown,
  logData: Record<string, unknown>,
  msg: string,
) {
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

/** Extracts the tRPC procedure path from the SSE request URL.
 *  `/api/sse/traces.onTraceUpdate` or `/api/sse/traces/onTraceUpdate` both
 *  resolve to `traces.onTraceUpdate` (the `/api/sse/` prefix is stripped and
 *  remaining segments join with "."). */
function sseProcedurePath(url: URL): string {
  const pathAfterSse = url.pathname.replace(/^\/api\/sse\/?/, "");
  return pathAfterSse.replace(/\//g, ".");
}

/** Resolves the tRPC procedure a request names, building the same inner
 *  context the tRPC route builds. Returns `null` when the path does not
 *  resolve to a callable procedure. */
async function resolveSseProcedure({
  raw,
  path,
}: {
  raw: Request;
  path: string;
}): Promise<((input: unknown) => unknown) | null> {
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
    // Subscriptions await an event that may never come; without this they stay
    // suspended after the browser is gone, holding their emitter listener and
    // skipping their own cleanup. Closing the stream cannot interrupt a
    // pending `await` from the outside, so the signal has to reach the
    // procedure itself.
    signal: raw.signal,
  });

  const router = await getAppRouter();
  const caller = router.createCaller(ctx);
  const procedure = path
    .split(".")
    .reduce<any>((obj, key) => obj?.[key], caller);

  return typeof procedure === "function" ? procedure : null;
}

/** The write/end/ping plumbing for one SSE connection, decoupled from what
 *  gets streamed through it. */
function createSseChannel(controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder();
  let ended = false;
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

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
    if (ping) clearInterval(ping);
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
  const startPing = () => {
    ping = setInterval(() => {
      if (ended) {
        end();
      } else {
        write(": ping\n\n");
      }
    }, 25_000);
  };

  return {
    write,
    writeData,
    end,
    isEnded: () => ended,
    setUnsubscribe: (fn: (() => void) | null) => {
      unsubscribe = fn;
    },
    startPing,
  };
}

type SseChannel = ReturnType<typeof createSseChannel>;

/** Streams an AsyncIterable result to completion, one item at a time. */
async function drainAsyncIterableResult({
  result,
  channel,
}: {
  result: AsyncIterable<unknown>;
  channel: SseChannel;
}): Promise<void> {
  for await (const data of result) {
    if (channel.isEnded()) break;
    channel.writeData(data);
  }
  channel.writeData({ type: "complete" });
  channel.end();
}

/** Subscribes to an Observable-like (tRPC subscription) result, wiring its
 *  unsubscribe back onto the channel so `channel.end()` tears it down. */
function subscribeObservableResult({
  result,
  channel,
  path,
}: {
  result: { subscribe: (observer: unknown) => unknown };
  channel: SseChannel;
  path: string;
}): void {
  const sub = result.subscribe({
    next: (data: unknown) => channel.writeData(data),
    complete: () => {
      channel.writeData({ type: "complete" });
      channel.end();
    },
    error: (err: unknown) => {
      logSseError(err, { err, path }, "SSE observable error");
      channel.writeData(sseErrorFrame(err));
      channel.end();
    },
  });

  if (typeof sub === "function") channel.setUnsubscribe(sub as () => void);
  else if (sub && typeof (sub as any).unsubscribe === "function")
    channel.setUnsubscribe(() => (sub as any).unsubscribe());
}

/** Runs the resolved procedure and forwards its result to the channel,
 *  supporting AsyncIterable results, Observable-like (tRPC subscription)
 *  results, and plain non-streaming results. */
async function runSseProcedure({
  procedure,
  input,
  channel,
  path,
}: {
  procedure: (input: unknown) => unknown;
  input: unknown;
  channel: SseChannel;
  path: string;
}): Promise<void> {
  try {
    const result = await procedure(input);

    if (result && typeof (result as any)[Symbol.asyncIterator] === "function") {
      await drainAsyncIterableResult({
        result: result as AsyncIterable<unknown>,
        channel,
      });
      return;
    }

    if (result && typeof (result as any).subscribe === "function") {
      subscribeObservableResult({
        result: result as { subscribe: (observer: unknown) => unknown },
        channel,
        path,
      });
      return; // Keep connection open for observable
    }

    // Non-streaming result
    channel.writeData(result);
    channel.writeData({ type: "complete" });
    channel.end();
  } catch (error) {
    // No `input` here: it is the raw request payload, which may carry
    // PII — same contract as the observable error path above.
    logSseError(error, { error, path }, "SSE handler error");
    channel.writeData(sseErrorFrame(error));
    channel.end();
  }
}

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      // Stream fan-out; per-message authorization happens upstream.
      permissions: [],
      credential: "session",
    }),
  )
  .get("/sse/*", async (c) => {
    const raw = c.req.raw;
    const url = new URL(raw.url);
    const path = sseProcedurePath(url);

    if (!path) {
      return c.json({ message: "Missing trpc path" }, 400);
    }

    // Parse input from query params
    const inputParam = url.searchParams.get("input") ?? undefined;
    const input = inputParam ? superjson.parse(inputParam) : undefined;

    const procedure = await resolveSseProcedure({ raw, path });
    if (!procedure) {
      return c.json({ message: "Procedure not found" }, 404);
    }

    // Set SSE headers
    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    const body = new ReadableStream({
      start(controller) {
        const channel = createSseChannel(controller);
        channel.startPing();

        // Send connected event
        channel.writeData({ type: "connected" });

        // Call the procedure and handle the result. Deliberately fire-and-forget:
        // the stream stays open while this runs, and the catch inside
        // `runSseProcedure` is the only place a rejection can surface.
        void runSseProcedure({ procedure, input, channel, path });

        // Handle client disconnect via AbortSignal on the request
        raw.signal?.addEventListener("abort", () => {
          channel.end();
        });
      },
    });

    return new Response(body, {
      status: 200,
      headers: c.res.headers,
    });
  });

export const app = secured.hono;
