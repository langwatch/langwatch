import { createLogger } from "@langwatch/observability";
import type { TRPCLink } from "@trpc/client";
import { TRPCClientError } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";

const logger = createLogger("langwatch:sse-link");

type SSEControlMessage =
  | { type: "connected" }
  | { type: "complete" }
  | { type: "error"; message?: string; [key: string]: unknown };

type SSEMessage = SSEControlMessage | unknown;

export interface SSELinkOptions {
  url: string;
  eventSourceOptions?: EventSourceInit;
  transformPath?: (path: string) => string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/**
 * Classify one parsed SSE frame. A `type: "error"` frame is AMBIGUOUS: the
 * route wrapper's PROTOCOL error (`{type:"error", message}`, the subscription
 * generator threw, see routes/sse.ts) shares its discriminant with legitimate
 * subscription DATA whose own union contains an error variant: the langy turn
 * stream's terminal is `{type:"error", error:"<serialized domain error>"}`.
 * The two shapes are disjoint (protocol always carries a string `message`,
 * a domain entry carries `error` and no `message`), so split on that: a domain
 * entry must flow to the subscriber as data, or every live-watched turn
 * failure collapses into a dead subscription and the generic unknown card
 * while the typed cause sits right there on the wire.
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

const toTrpcError = <TRouter extends AnyRouter>(
  err: unknown,
  prefix: string,
) => {
  const msg = err instanceof Error ? err.message : String(err);
  return TRPCClientError.from<TRouter>(new Error(`${prefix}: ${msg}`));
};

type SSEState = {
  es: EventSource | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  closed: boolean;
  startedSent: boolean;
};

export function sseLink<TRouter extends AnyRouter = AnyRouter>(
  options: SSELinkOptions,
): TRPCLink<TRouter> {
  const {
    url,
    eventSourceOptions = {},
    transformPath = (path) => path,
    maxReconnectAttempts = 5,
    reconnectDelay = 1000,
  } = options;

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid SSE URL: ${url}`);
  }

  return () =>
    ({ op, next }) => {
      if (op.type !== "subscription") return next(op);

      return observable((observer) => {
        const state: SSEState = {
          es: null,
          reconnectTimer: null,
          reconnectAttempts: 0,
          closed: false,
          startedSent: false,
        };

        const clearReconnectTimer = () => {
          if (!state.reconnectTimer) return;
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        };

        const close = () => {
          if (state.closed) return;
          state.closed = true;
          clearReconnectTimer();
          state.es?.close();
          state.es = null;
        };

        const buildUrl = (): URL => {
          const base = new URL(url);
          const basePath = base.pathname.endsWith("/")
            ? base.pathname
            : `${base.pathname}/`;
          const opPath = transformPath(op.path).replace(/^\//, "");
          base.pathname = `${basePath}${opPath}`;

          if (op.input !== void 0) {
            base.searchParams.set("input", superjson.stringify(op.input));
          }
          return base;
        };

        const connect = () => {
          setupEventSource({
            state,
            buildUrl,
            observer,
            eventSourceOptions,
            maxReconnectAttempts,
            reconnectDelay,
            close,
            op,
          });
        };

        connect();
        return close;
      });
    };
}

interface SSESetupContext {
  state: SSEState;
  buildUrl: () => URL;
  observer: any;
  eventSourceOptions: EventSourceInit;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  close: () => void;
  op: any;
}

function setupEventSource(context: SSESetupContext) {
  const {
    state,
    buildUrl,
    observer,
    eventSourceOptions,
    maxReconnectAttempts,
    reconnectDelay,
    close,
    op,
  } = context;
  if (state.closed) return;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  state.es?.close();
  state.es = null;

  const endpointUrl = buildUrl();
  logger.info(
    { path: endpointUrl.pathname, input: op.input },
    "Initiating SSE connection",
  );
  state.es = new EventSource(endpointUrl.toString(), eventSourceOptions);

  state.es.onopen = () => {
    state.reconnectAttempts = 0;
    logger.info({ path: endpointUrl.pathname }, "SSE connected");

    if (!state.closed && !state.startedSent) {
      state.startedSent = true;
      logger.debug({ path: endpointUrl.pathname }, "SSE started event sent");
      observer.next({ result: { type: "started" } });
    }
  };

  state.es.onmessage = (event) => {
    if (state.closed) return;

    try {
      const parsed = superjson.parse(event.data) as SSEMessage;
      handleMessage({ parsed, endpointUrl, state, observer, close });
    } catch (error) {
      logger.error({ error }, "SSE message parse failed");
      observer.error(toTrpcError(error, "SSE message parsing failed"));
      close();
    }
  };

  state.es.onerror = () => {
    handleEventSourceError({
      state,
      observer,
      endpointUrl,
      maxReconnectAttempts,
      reconnectDelay,
      close,
      buildUrl,
      eventSourceOptions,
      op,
    });
  };
}

interface HandleMessageContext {
  parsed: unknown;
  endpointUrl: URL;
  state: SSEState;
  observer: any;
  close: () => void;
}

function handleMessage({
  parsed,
  endpointUrl,
  state,
  observer,
  close,
}: HandleMessageContext) {
  switch (classifySseFrame(parsed)) {
    case "connected":
      logger.debug(
        { path: endpointUrl.pathname },
        "SSE connection acknowledged",
      );
      return;
    case "complete":
      logger.info({ path: endpointUrl.pathname }, "SSE stream completed");
      observer.complete();
      close();
      return;
    case "protocol-error": {
      const msg =
        isObject(parsed) && typeof parsed.message === "string"
          ? parsed.message
          : "SSE Error";
      logger.error(
        { path: endpointUrl.pathname, error: msg },
        "SSE error message received",
      );
      observer.error(TRPCClientError.from(new Error(msg)));
      close();
      return;
    }
    case "data":
      break;
  }

  logger.debug(
    { path: endpointUrl.pathname, dataType: typeof parsed },
    "SSE data message received",
  );
  observer.next({
    result: { type: "data", data: parsed as unknown },
  });
}

interface HandleEventSourceErrorContext {
  state: SSEState;
  observer: any;
  endpointUrl: URL;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  close: () => void;
  buildUrl: () => URL;
  eventSourceOptions: EventSourceInit;
  op: any;
}

function handleEventSourceError({
  state,
  observer,
  endpointUrl,
  maxReconnectAttempts,
  reconnectDelay,
  close,
  buildUrl,
  eventSourceOptions,
  op,
}: HandleEventSourceErrorContext) {
  if (state.closed) return;

  logger.warn(
    {
      readyState: state.es?.readyState,
      attempt: state.reconnectAttempts + 1,
      maxReconnectAttempts,
    },
    "SSE error",
  );

  state.es?.close();
  state.es = null;

  if (state.reconnectAttempts >= maxReconnectAttempts) {
    observer.error(
      TRPCClientError.from(
        new Error(
          `SSE connection failed after ${maxReconnectAttempts} attempts`,
        ),
      ),
    );
    close();
    return;
  }

  state.reconnectAttempts += 1;
  const delay = reconnectDelay * Math.pow(2, state.reconnectAttempts - 1);
  logger.info(
    {
      attempt: state.reconnectAttempts,
      delay,
      path: endpointUrl.pathname,
    },
    "Scheduling SSE reconnection",
  );
  state.reconnectTimer = setTimeout(
    () =>
      !state.closed &&
      setupEventSource({
        state,
        buildUrl,
        observer,
        eventSourceOptions,
        maxReconnectAttempts,
        reconnectDelay,
        close,
        op,
      }),
    delay,
  );
}
