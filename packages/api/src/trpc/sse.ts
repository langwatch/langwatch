/**
 * The subscription lane: tRPC subscriptions served as one SSE endpoint over
 * the SAME composed router as the request lane, so a procedure is reachable
 * live exactly when it is reachable at all.
 */
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";

import { credentialClassFor, handlerManagedAuth } from "../access-policy.ts";
import {
  LiveStreamCrossSiteBlockedError,
  LiveStreamNotFoundError,
  LiveStreamUnsupportedProcedureError,
} from "../errors.ts";
import { BrowserOriginGuard, registerRoutePolicy } from "../rest/security.ts";

/** How often the channel writes a comment so an idle proxy keeps it open. */
const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * The caller a request's subscription is resolved on: a nested record whose
 * leaves are the procedures, exactly what `router.createCaller` returns.
 * `unknown` rather than a router-derived type on purpose.
 */
export type SseSubscriptionCaller = unknown;

/** What the lane needs from the tRPC host so a path can be resolved and run. */
export interface SseSubscriptionMembers {
  /** Build the caller this request's procedure is looked up on. */
  createCaller(options: {
    request: Request;
    signal: AbortSignal | undefined;
  }): Promise<SseSubscriptionCaller>;

  /**
   * What KIND of procedure the composed router carries at a dotted path, read
   * off its own procedure record rather than off the caller.
   */
  procedureTypeAt(path: string): "query" | "mutation" | "subscription" | undefined;
}

type Logged = Pick<Logger, "debug" | "info" | "warn" | "error">;

/**
 * What this lane answers behind. Handler-managed because the session is
 * resolved by the process's own caller factory INSIDE the handler rather than
 * by a credential resolver ahead of it: the lane has no scope of its own.
 */
const SSE_ACCESS = handlerManagedAuth({
  reason: "user session validated in-handler by the process's caller factory",
  // Stream fan-out; per-message authorization happens upstream.
  permissions: [],
  credential: "session",
});

export class SseLane {
  static create(options: { members: SseSubscriptionMembers; logger?: Logged }): SseLane {
    return new SseLane(options.members, options.logger ?? createLogger("langwatch:api:sse"));
  }

  private constructor(
    private readonly members: SseSubscriptionMembers,
    private readonly logger: Logged,
  ) {
    // The one statement of this lane's access, so the authorization audit and
    // the document generator read the same policy a declared family publishes.
    registerRoutePolicy({
      method: "GET",
      path: "/api/sse/*",
      policy: SSE_ACCESS,
      family: "sse",
      credentialClass: credentialClassFor({ scope: "session", policy: SSE_ACCESS }),
      credential: "browser",
    });
  }

  /** Answers one `/api/sse/*` request; the hosting side owns the route that reaches it. */
  async answer(raw: Request, answerHeaders: Headers): Promise<Response> {
    const url = new URL(raw.url);

    // Before anything is parsed or resolved: the channel is opened by this
    // application's own pages with a cookie the browser attaches to a
    // cross-site top-level GET as well.
    const header = (name: string) => raw.headers.get(name) ?? undefined;

    if (!BrowserOriginGuard.isFromOwnOrigin({ req: { header } })) {
      throw new LiveStreamCrossSiteBlockedError();
    }

    // An address that names no channel at all is a channel we do not serve —
    // the same answer as a path naming a procedure that is not there.
    const path = subscriptionPathOf(url);

    if (!path) throw new LiveStreamNotFoundError();

    // Both refusals come BEFORE the caller exists: building one resolves the
    // request's session and context, and a path this lane will not serve
    // should cost neither.
    const procedureType = this.members.procedureTypeAt(path);

    if (!procedureType) throw new LiveStreamNotFoundError();

    if (procedureType !== "subscription") throw new LiveStreamUnsupportedProcedureError();

    const inputParam = url.searchParams.get("input") ?? undefined;
    const input = inputParam ? (JSON.parse(inputParam) as unknown) : undefined;
    const caller = await this.members.createCaller({ request: raw, signal: raw.signal });
    const procedure = procedureAt(caller, path);

    if (!procedure) throw new LiveStreamNotFoundError();

    const headers = new Headers(answerHeaders);
    headers.set("Content-Type", "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");

    return new Response(this.stream({ raw, procedure, input, path }), { status: 200, headers });
  }

  private stream({
    raw,
    procedure,
    input,
    path,
  }: {
    raw: Request;
    procedure: (input: unknown) => unknown;
    input: unknown;
    path: string;
  }): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        const channel = new SseChannel(controller, this.logger);

        channel.writeData({ type: "connected" });
        // Deliberately fire-and-forget: the stream stays open while this
        // runs, and `deliver`'s own catch is the only place a rejection
        // surfaces.
        void this.deliver({ channel, procedure, input, path });
        raw.signal?.addEventListener("abort", () => channel.end());
      },
    });
  }

  /** Runs the procedure and forwards whatever shape it answers with. */
  private async deliver({
    channel,
    procedure,
    input,
    path,
  }: {
    channel: SseChannel;
    procedure: (input: unknown) => unknown;
    input: unknown;
    path: string;
  }): Promise<void> {
    try {
      const result = await procedure(input);

      if (isAsyncIterable(result)) {
        await forwardIterable(channel, result);

        return;
      }

      if (isObservable(result)) {
        // The connection stays open for an observable; completion closes it.
        this.forwardObservable(channel, result, path);

        return;
      }

      channel.writeData(result);
      channel.complete();
    } catch (error) {
      // No `input` here: it is the raw request payload, which may carry
      // PII — same contract as the observable error path.
      logStreamFailure({
        logger: this.logger,
        err: error,
        logData: { error, path },
        msg: "SSE handler error",
      });
      channel.writeData(sseErrorFrame(error));
      channel.end();
    }
  }

  private forwardObservable(channel: SseChannel, result: ObservableLike, path: string): void {
    const sub = result.subscribe({
      next: (data: unknown) => channel.writeData(data),
      complete: () => channel.complete(),
      error: (err: unknown) => {
        logStreamFailure({
          logger: this.logger,
          err,
          logData: { err, path },
          msg: "SSE observable error",
        });
        channel.writeData(sseErrorFrame(err));
        channel.end();
      },
    });

    if (typeof sub === "function") channel.onEnd(sub);
    else if (sub && typeof sub.unsubscribe === "function") channel.onEnd(() => sub.unsubscribe());
  }
}

async function forwardIterable(channel: SseChannel, result: AsyncIterable<unknown>): Promise<void> {
  for await (const data of result) {
    if (channel.ended) break;

    channel.writeData(data);
  }

  channel.complete();
}

/** One open event stream: framed writes, a keepalive, and exactly one close. */
class SseChannel {
  readonly #encoder = new TextEncoder();
  readonly #ping: ReturnType<typeof setInterval>;
  #ended = false;
  #unsubscribe: (() => void) | null = null;

  constructor(
    private readonly controller: ReadableStreamDefaultController,
    private readonly logger: Logged,
  ) {
    this.#ping = setInterval(() => this.#write(": ping\n\n"), SSE_KEEPALIVE_INTERVAL_MS);
  }

  get ended(): boolean {
    return this.#ended;
  }

  /** What to release when the stream closes, however it closes. */
  onEnd(unsubscribe: () => void): void {
    this.#unsubscribe = unsubscribe;
  }

  writeData(value: unknown): void {
    if (this.#ended) return;

    const payload = JSON.stringify(value);

    for (const line of payload.split(/\r?\n/)) {
      this.#write(`data: ${line}\n`);
    }

    this.#write("\n");
  }

  complete(): void {
    this.writeData({ type: "complete" });
    this.end();
  }

  end(): void {
    if (this.#ended) return;

    this.#ended = true;
    clearInterval(this.#ping);

    try {
      this.#unsubscribe?.();
    } catch (error) {
      // The subscription is being released either way; closing continues.
      this.logger.debug({ error }, "SSE unsubscribe failed during close");
    }

    this.#unsubscribe = null;

    try {
      this.controller.close();
    } catch (error) {
      // Already closed by the peer; there is nothing further to release.
      this.logger.debug({ error }, "SSE stream was already closed");
    }
  }

  #write(text: string): void {
    if (this.#ended) return;

    try {
      this.controller.enqueue(this.#encoder.encode(text));
    } catch {
      // Stream already closed
      this.end();
    }
  }
}

/** The SSE error frame (ADR-045). */
function sseErrorFrame(err: unknown): Record<string, unknown> {
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

/** The procedure a dotted path names, or undefined when the path names none. */
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

/**
 * Stream-failure logging, same fault-axis rule as the tRPC and REST request
 * loggers: customer-fault handled errors warn (spike-watched), platform /
 * provider and unhandled errors log at error.
 */
function logStreamFailure({
  logger,
  err,
  logData,
  msg,
}: {
  logger: Logged;
  err: unknown;
  logData: Record<string, unknown>;
  msg: string;
}) {
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
