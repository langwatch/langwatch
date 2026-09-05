/**
 * The subscription lane: every tRPC subscription this process serves, over one
 * hand-rolled Server-Sent Events channel. It is NOT `@trpc/server`'s own SSE format.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, SecuredApp } from "@langwatch/api/rest";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { isCrossSiteRequest } from "../api-rest.cross-site";
import {
  LiveStreamCrossSiteBlockedError,
  LiveStreamNotFoundError,
  LiveStreamUnsupportedProcedureError,
} from "./app-trpc.sse.errors";

/** How often the channel writes a comment so an idle proxy keeps it open. */
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * The caller a request's subscription is resolved on: a nested record whose leaves are
 * the procedures, exactly what `router.createCaller` returns. `unknown` rather than a
 * router-derived type on purpose.
 */
export type SseSubscriptionCaller = unknown;

/** What the process supplies so a path can be resolved and run. */
export interface SseSubscriptionPorts {
  /**
   * Build the caller this request's procedure is looked up on.
   */
  createCaller(options: {
    request: Request;
    signal: AbortSignal | undefined;
  }): Promise<SseSubscriptionCaller>;

  /**
   * What KIND of procedure the composed router carries at a dotted path, read off its own
   * procedure record rather than off the caller. The caller cannot answer this.
   */
  procedureTypeAt(path: string): "query" | "mutation" | "subscription" | undefined;
}

/**
 * The SSE error frame.
 * (ADR-045).
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
 * The procedure a dotted path names, or undefined when the path names none.
 */
function procedureAt(
  caller: SseSubscriptionCaller,
  path: string,
): ((input: unknown) => unknown) | undefined {
  const resolved = path.split(".").reduce<unknown>((node, key) => {
    if (node === null || (typeof node !== "object" && typeof node !== "function")) return undefined;
    return (node as Record<string, unknown>)[key];
  }, caller);
  return typeof resolved === "function" ? (resolved as (input: unknown) => unknown) : undefined;
}

/** The dotted procedure path a request addresses, or "" when it names none. */
function subscriptionPathOf(url: URL): string {
  return url.pathname.replace(/^\/api\/sse\/?/, "").replace(/\//g, ".");
}

type Logged = Pick<Logger, "debug" | "info" | "warn" | "error">;

/**
 * Stream-failure logging, same fault-axis rule as the tRPC and REST request
 * loggers: customer-fault handled errors warn (spike-watched), platform /
 * provider and unhandled errors log at error.
 */
function logStreamFailure(
  logger: Logged,
  err: unknown,
  logData: Record<string, unknown>,
  msg: string,
) {
  const handled = handledCauseOf(err);
  const level = handled && handled.fault === "customer" ? "warn" : "error";
  logger[level](
    {
      ...logData,
      ...(handled ? { handledErrorCode: handled.code, handledErrorFault: handled.fault } : {}),
    },
    msg,
  );
}

/**
 * Mount the subscription lane on one process's REST security.
 */
export function createSseSubscriptionApp(options: {
  security: AppRestSecurity;
  ports: SseSubscriptionPorts;
  logger?: Logged;
}): SecuredApp<Record<never, never>> {
  const { ports } = options;
  const logger = options.logger ?? createLogger("langwatch:api:sse");
  const secured = options.security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler by the process's caller factory",
        // Stream fan-out; per-message authorization happens upstream.
        permissions: [],
        credential: "session",
      }),
    )
    .get("/sse/*", async (c) => {
      const raw = c.req.raw;
      const url = new URL(raw.url);

      // Before anything is parsed or resolved: the channel is opened by this
      // application's own pages with a cookie the browser attaches to a
      // cross-site top-level GET as well.
      if (isCrossSiteRequest(c)) {
        throw new LiveStreamCrossSiteBlockedError();
      }

      const path = subscriptionPathOf(url);
      if (!path) {
        return c.json({ message: "Missing trpc path" }, 400);
      }

      // Both refusals come BEFORE the caller exists: building one resolves the
      // request's session and context, and a path this lane will not serve
      // should cost neither.
      const procedureType = ports.procedureTypeAt(path);
      if (!procedureType) {
        throw new LiveStreamNotFoundError();
      }
      if (procedureType !== "subscription") {
        throw new LiveStreamUnsupportedProcedureError();
      }

      const inputParam = url.searchParams.get("input") ?? undefined;
      const input = inputParam ? superjson.parse(inputParam) : undefined;

      const caller = await ports.createCaller({ request: raw, signal: raw.signal });
      const procedure = procedureAt(caller, path);
      if (!procedure) {
        throw new LiveStreamNotFoundError();
      }

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

          const ping = setInterval(() => {
            if (ended) {
              end();
            } else {
              write(": ping\n\n");
            }
          }, SSE_KEEPALIVE_INTERVAL_MS);

          writeData({ type: "connected" });

          // Deliberately fire-and-forget: the stream stays open while this
          // runs, and the catch below is the only place a rejection surfaces.
          void (async () => {
            try {
              const result = await procedure(input);

              if (isAsyncIterable(result)) {
                for await (const data of result) {
                  if (ended) break;
                  writeData(data);
                }
                writeData({ type: "complete" });
                end();
                return;
              }

              if (isObservable(result)) {
                const sub = result.subscribe({
                  next: (data: unknown) => writeData(data),
                  complete: () => {
                    writeData({ type: "complete" });
                    end();
                  },
                  error: (err: unknown) => {
                    logStreamFailure(logger, err, { err, path }, "SSE observable error");
                    writeData(sseErrorFrame(err));
                    end();
                  },
                });

                if (typeof sub === "function") unsubscribe = sub;
                else if (sub && typeof sub.unsubscribe === "function")
                  unsubscribe = () => sub.unsubscribe();

                return; // Keep the connection open for an observable
              }

              writeData(result);
              writeData({ type: "complete" });
              end();
            } catch (error) {
              // No `input` here: it is the raw request payload, which may carry
              // PII — same contract as the observable error path above.
              logStreamFailure(logger, error, { error, path }, "SSE handler error");
              writeData(sseErrorFrame(error));
              end();
            }
          })();

          raw.signal?.addEventListener("abort", () => {
            end();
          });
        },
      });

      return new Response(body, { status: 200, headers: c.res.headers });
    });

  return secured;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  );
}

type ObservableLike = {
  subscribe(observer: {
    next(value: unknown): void;
    complete(): void;
    error(err: unknown): void;
  }): (() => void) | { unsubscribe(): void } | undefined;
};

function isObservable(value: unknown): value is ObservableLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ObservableLike).subscribe === "function"
  );
}
