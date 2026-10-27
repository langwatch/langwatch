/**
 * The tRPC link that carries a subscription over this application's own SSE
 * frame format (not tRPC's wire format) and the same-origin session cookie.
 * See ADR-128 (public REST / internal tRPC), subscription-wire appendix.
 */

import type { TRPCLink } from "@trpc/client";
import { TRPCClientError } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

/**
 * How many consecutive failures are retried before the subscription gives up.
 * The platform host's pin; a live indicator that gave up sooner would read as
 * an outage during an ordinary deploy.
 */
export const SSE_SUBSCRIPTION_MAX_RECONNECT_ATTEMPTS = 5;

/** The first retry's wait. Each further attempt doubles it. */
export const SSE_SUBSCRIPTION_RECONNECT_DELAY_MS = 1000;

/** Encodes the subscription input and decodes each frame. `JSON`, in practice. */
export interface SseFrameTransformer {
  stringify(value: unknown): string;
  parse(text: string): unknown;
}

/** The part of `EventSource` this link uses. */
export interface SseEventSourceLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export type SseEventSourceConstructor = new (
  url: string,
  init?: { withCredentials?: boolean },
) => SseEventSourceLike;

export interface SseSubscriptionLinkOptions {
  /** Absolute base the procedure path is appended to. Its origin is the auth seam. */
  url: string;
  transformer: SseFrameTransformer;
  /** Turns a procedure path into the URL path that serves it. */
  transformPath?: (path: string) => string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  /** Passed to the constructor. Same-origin needs nothing, so this is `{}`. */
  eventSourceOptions?: { withCredentials?: boolean };
  /** Supplied by a test; production reads the browser's. */
  eventSource?: SseEventSourceConstructor;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A `type: "error"` frame is ambiguous: a protocol error carries `message`,
 * a domain error (e.g. a turn-stream failure) carries `error` with none —
 * misclassifying one collapses it into a dead subscription.
 */
export function classifySseFrame(
  parsed: unknown,
): "connected" | "complete" | "protocol-error" | "data" {
  if (!isObject(parsed) || typeof parsed.type !== "string") return "data";
  switch (parsed.type) {
    case "connected":
      return "connected";
    case "complete":
      return "complete";
    case "error":
      if (typeof parsed.message !== "string" && "error" in parsed) {
        return "data";
      }
      return "protocol-error";
    default:
      return "data";
  }
}

function resolveEventSource(
  explicit: SseEventSourceConstructor | undefined,
): SseEventSourceConstructor {
  if (explicit) return explicit;
  const fromGlobal = (globalThis as { EventSource?: SseEventSourceConstructor }).EventSource;
  if (!fromGlobal) {
    throw new Error(
      "This runtime has no EventSource, so a live subscription cannot be opened here.",
    );
  }
  return fromGlobal;
}

/** The observer one subscription reports to: tRPC's, as the link hands it over. */
interface SseSubscriptionObserver<TRouter extends AnyRouter> {
  next(value: { result: { type: "started" } | { type: "data"; data: unknown } }): void;
  error(error: TRPCClientError<TRouter>): void;
  complete(): void;
}

/** What one subscription needs from the link's options and its operation. */
interface SseSubscriptionInput<TRouter extends AnyRouter> {
  /** Built on every connect, as each attempt encodes the input afresh. */
  buildUrl: () => URL;
  transformer: SseFrameTransformer;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  eventSourceOptions: { withCredentials?: boolean };
  EventSourceCtor: SseEventSourceConstructor;
  observer: SseSubscriptionObserver<TRouter>;
}

/** One live subscription: its source, its reconnect schedule, and whether it is over. */
class SseSubscription<TRouter extends AnyRouter> {
  private source: SseEventSourceLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closed = false;
  private startedSent = false;

  constructor(private readonly input: SseSubscriptionInput<TRouter>) {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearReconnectTimer();
    this.source?.close();
    this.source = null;
  }

  connect(): void {
    if (this.closed) return;
    this.clearReconnectTimer();

    this.source?.close();
    this.source = null;
    const source = new this.input.EventSourceCtor(
      this.input.buildUrl().toString(),
      this.input.eventSourceOptions,
    );
    this.source = source;

    source.onopen = () => this.onOpen();
    source.onmessage = (event) => this.onMessage(event.data);
    source.onerror = () => this.onError();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private fail(message: string): void {
    this.input.observer.error(TRPCClientError.from<TRouter>(new Error(message)));
    this.close();
  }

  private onOpen(): void {
    this.reconnectAttempts = 0;
    if (this.closed || this.startedSent) return;
    this.startedSent = true;
    this.input.observer.next({ result: { type: "started" } });
  }

  private onMessage(raw: string): void {
    if (this.closed) return;
    try {
      this.onFrame(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.fail(`SSE message parsing failed: ${detail}`);
    }
  }

  private onFrame(raw: string): void {
    const parsed = this.input.transformer.parse(raw);

    switch (classifySseFrame(parsed)) {
      case "connected":
        return;
      case "complete":
        this.input.observer.complete();
        this.close();
        return;
      case "protocol-error":
        this.fail(
          isObject(parsed) && typeof parsed.message === "string" ? parsed.message : "SSE Error",
        );
        return;
      case "data":
        this.input.observer.next({ result: { type: "data", data: parsed as unknown } });
    }
  }

  private onError(): void {
    if (this.closed) return;

    this.source?.close();
    this.source = null;

    const { maxReconnectAttempts, reconnectDelay } = this.input;
    if (this.reconnectAttempts >= maxReconnectAttempts) {
      this.fail(`SSE connection failed after ${maxReconnectAttempts} attempts`);
      return;
    }

    this.reconnectAttempts += 1;
    const delay = reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.connect();
    }, delay);
  }
}

/** The procedure's URL: the base path, the op's path, and its encoded input. */
function subscriptionUrl({
  url,
  path,
  input,
  transformer,
  transformPath,
}: {
  url: string;
  path: string;
  input: unknown;
  transformer: SseFrameTransformer;
  transformPath: (path: string) => string;
}): URL {
  const base = new URL(url);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const opPath = transformPath(path).replace(/^\//, "");
  base.pathname = `${basePath}${opPath}`;

  if (input !== void 0) {
    base.searchParams.set("input", transformer.stringify(input));
  }
  return base;
}

/**
 * The link. Subscriptions are handled; everything else is handed to the next
 * link untouched, so this composes under a `splitLink` or on its own.
 */
export function sseSubscriptionLink<TRouter extends AnyRouter = AnyRouter>(
  options: SseSubscriptionLinkOptions,
): TRPCLink<TRouter> {
  const {
    url,
    transformer,
    transformPath = (path) => path,
    maxReconnectAttempts = SSE_SUBSCRIPTION_MAX_RECONNECT_ATTEMPTS,
    reconnectDelay = SSE_SUBSCRIPTION_RECONNECT_DELAY_MS,
    eventSourceOptions = {},
    eventSource,
  } = options;

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid subscription base URL: ${url}`);
  }

  return () =>
    ({ op, next }) => {
      if (op.type !== "subscription") return next(op);

      return observable((observer) => {
        const subscription = new SseSubscription<TRouter>({
          buildUrl: () =>
            subscriptionUrl({ url, path: op.path, input: op.input, transformer, transformPath }),
          transformer,
          maxReconnectAttempts,
          reconnectDelay,
          eventSourceOptions,
          EventSourceCtor: resolveEventSource(eventSource),
          observer,
        });
        subscription.connect();
        return () => subscription.close();
      });
    };
}
