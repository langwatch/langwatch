/**
 * The tRPC link that carries a subscription over this application's own SSE
 * frame format (not tRPC's wire format) and the same-origin session cookie.
 * See dev/docs/plans/ui-subscription-transport.md.
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

/** Encodes the subscription input and decodes each frame. superjson, in practice. */
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
        const EventSourceCtor = resolveEventSource(eventSource);
        let source: SseEventSourceLike | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectAttempts = 0;
        let closed = false;
        let startedSent = false;

        const clearReconnectTimer = () => {
          if (!reconnectTimer) return;
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        };

        const close = () => {
          if (closed) return;
          closed = true;
          clearReconnectTimer();
          source?.close();
          source = null;
        };

        const buildUrl = (): URL => {
          const base = new URL(url);
          const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
          const opPath = transformPath(op.path).replace(/^\//, "");
          base.pathname = `${basePath}${opPath}`;

          if (op.input !== void 0) {
            base.searchParams.set("input", transformer.stringify(op.input));
          }
          return base;
        };

        const onFrame = (raw: string) => {
          const parsed = transformer.parse(raw);

          switch (classifySseFrame(parsed)) {
            case "connected":
              return;
            case "complete":
              observer.complete();
              close();
              return;
            case "protocol-error": {
              const message =
                isObject(parsed) && typeof parsed.message === "string"
                  ? parsed.message
                  : "SSE Error";
              observer.error(TRPCClientError.from<TRouter>(new Error(message)));
              close();
              return;
            }
            case "data":
              observer.next({ result: { type: "data", data: parsed as unknown } });
          }
        };

        const connect = () => {
          if (closed) return;
          clearReconnectTimer();

          source?.close();
          source = null;
          source = new EventSourceCtor(buildUrl().toString(), eventSourceOptions);

          source.onopen = () => {
            reconnectAttempts = 0;
            if (closed || startedSent) return;
            startedSent = true;
            observer.next({ result: { type: "started" } });
          };

          source.onmessage = (event) => {
            if (closed) return;
            try {
              onFrame(event.data);
            } catch (error) {
              const detail = error instanceof Error ? error.message : String(error);
              observer.error(
                TRPCClientError.from<TRouter>(new Error(`SSE message parsing failed: ${detail}`)),
              );
              close();
            }
          };

          source.onerror = () => {
            if (closed) return;

            source?.close();
            source = null;

            if (reconnectAttempts >= maxReconnectAttempts) {
              observer.error(
                TRPCClientError.from<TRouter>(
                  new Error(`SSE connection failed after ${maxReconnectAttempts} attempts`),
                ),
              );
              close();
              return;
            }

            reconnectAttempts += 1;
            const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1);
            reconnectTimer = setTimeout(() => {
              if (!closed) connect();
            }, delay);
          };
        };

        connect();
        return close;
      });
    };
}
