import { createLogger } from "@langwatch/observability";
import type {
  Operation,
  OperationResultObserver,
  TRPCLink,
} from "@trpc/client";
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

/** {@link SSELinkOptions} with every default already applied. */
interface SSELinkRuntimeOptions {
  url: string;
  eventSourceOptions: EventSourceInit;
  transformPath: (path: string) => string;
  maxReconnectAttempts: number;
  reconnectDelay: number;
}

/**
 * The one mutable cell per subscription. Every handler reads and writes it
 * rather than a captured variable, so a handler attached to a superseded
 * EventSource still sees the connection that is current now — the behaviour
 * the shared `es` binding used to give.
 */
interface SSEConnectionState {
  es: EventSource | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  closed: boolean;
  startedSent: boolean;
}

const clearReconnectTimer = (state: SSEConnectionState) => {
  if (!state.reconnectTimer) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
};

const closeConnection = (state: SSEConnectionState) => {
  if (state.closed) return;
  state.closed = true;
  clearReconnectTimer(state);
  state.es?.close();
  state.es = null;
};

const buildEndpointUrl = ({
  options,
  op,
}: {
  options: SSELinkRuntimeOptions;
  op: Operation;
}): URL => {
  const base = new URL(options.url);
  const basePath = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;
  const opPath = options.transformPath(op.path).replace(/^\//, "");
  base.pathname = `${basePath}${opPath}`;

  if (op.input !== void 0) {
    base.searchParams.set("input", superjson.stringify(op.input));
  }
  return base;
};

const handleOpen = <TRouter extends AnyRouter>({
  state,
  observer,
  path,
}: {
  state: SSEConnectionState;
  observer: OperationResultObserver<TRouter, unknown>;
  path: string;
}) => {
  state.reconnectAttempts = 0;
  logger.info({ path }, "SSE connected");

  if (!state.closed && !state.startedSent) {
    state.startedSent = true;
    logger.debug({ path }, "SSE started event sent");
    observer.next({ result: { type: "started" } });
  }
};

const dispatchFrame = <TRouter extends AnyRouter>({
  parsed,
  state,
  observer,
  path,
}: {
  parsed: SSEMessage;
  state: SSEConnectionState;
  observer: OperationResultObserver<TRouter, unknown>;
  path: string;
}) => {
  switch (classifySseFrame(parsed)) {
    case "connected":
      logger.debug({ path }, "SSE connection acknowledged");
      return;
    case "complete":
      logger.info({ path }, "SSE stream completed");
      observer.complete();
      closeConnection(state);
      return;
    case "protocol-error": {
      const msg =
        isObject(parsed) && typeof parsed.message === "string"
          ? parsed.message
          : "SSE Error";
      logger.error({ path, error: msg }, "SSE error message received");
      observer.error(TRPCClientError.from<TRouter>(new Error(msg)));
      closeConnection(state);
      return;
    }
    case "data":
      break;
  }

  logger.debug({ path, dataType: typeof parsed }, "SSE data message received");
  observer.next({
    result: { type: "data", data: parsed as unknown },
  });
};

const handleMessage = <TRouter extends AnyRouter>({
  event,
  state,
  observer,
  path,
}: {
  event: MessageEvent;
  state: SSEConnectionState;
  observer: OperationResultObserver<TRouter, unknown>;
  path: string;
}) => {
  if (state.closed) return;

  try {
    const parsed = superjson.parse(event.data) as SSEMessage;
    dispatchFrame<TRouter>({ parsed, state, observer, path });
  } catch (error) {
    logger.error({ error }, "SSE message parse failed");
    observer.error(toTrpcError<TRouter>(error, "SSE message parsing failed"));
    closeConnection(state);
  }
};

const scheduleReconnect = ({
  state,
  options,
  path,
  connect,
}: {
  state: SSEConnectionState;
  options: SSELinkRuntimeOptions;
  path: string;
  connect: () => void;
}) => {
  state.reconnectAttempts += 1;
  const delay =
    options.reconnectDelay * Math.pow(2, state.reconnectAttempts - 1);
  logger.info(
    { attempt: state.reconnectAttempts, delay, path },
    "Scheduling SSE reconnection",
  );
  state.reconnectTimer = setTimeout(() => !state.closed && connect(), delay);
};

const handleConnectionError = <TRouter extends AnyRouter>({
  state,
  observer,
  options,
  path,
  connect,
}: {
  state: SSEConnectionState;
  observer: OperationResultObserver<TRouter, unknown>;
  options: SSELinkRuntimeOptions;
  path: string;
  connect: () => void;
}) => {
  if (state.closed) return;

  logger.warn(
    {
      readyState: state.es?.readyState,
      attempt: state.reconnectAttempts + 1,
      maxReconnectAttempts: options.maxReconnectAttempts,
    },
    "SSE error",
  );

  state.es?.close();
  state.es = null;

  if (state.reconnectAttempts >= options.maxReconnectAttempts) {
    observer.error(
      TRPCClientError.from<TRouter>(
        new Error(
          `SSE connection failed after ${options.maxReconnectAttempts} attempts`,
        ),
      ),
    );
    closeConnection(state);
    return;
  }

  scheduleReconnect({ state, options, path, connect });
};

const createConnect = <TRouter extends AnyRouter>({
  state,
  observer,
  options,
  op,
}: {
  state: SSEConnectionState;
  observer: OperationResultObserver<TRouter, unknown>;
  options: SSELinkRuntimeOptions;
  op: Operation;
}): (() => void) => {
  const connect = () => {
    if (state.closed) return;
    clearReconnectTimer(state);

    state.es?.close();
    state.es = null;

    const endpointUrl = buildEndpointUrl({ options, op });
    const path = endpointUrl.pathname;
    logger.info({ path, input: op.input }, "Initiating SSE connection");

    const es = new EventSource(
      endpointUrl.toString(),
      options.eventSourceOptions,
    );
    state.es = es;

    es.onopen = () => handleOpen<TRouter>({ state, observer, path });

    es.onmessage = (event) =>
      handleMessage<TRouter>({ event, state, observer, path });

    es.onerror = () =>
      handleConnectionError<TRouter>({
        state,
        observer,
        options,
        path,
        connect,
      });
  };

  return connect;
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

  const runtimeOptions: SSELinkRuntimeOptions = {
    url,
    eventSourceOptions,
    transformPath,
    maxReconnectAttempts,
    reconnectDelay,
  };

  return () =>
    ({ op, next }) => {
      if (op.type !== "subscription") return next(op);

      return observable((observer) => {
        const state: SSEConnectionState = {
          es: null,
          reconnectTimer: null,
          reconnectAttempts: 0,
          closed: false,
          startedSent: false,
        };

        const connect = createConnect<TRouter>({
          state,
          observer,
          options: runtimeOptions,
          op,
        });

        connect();
        return () => closeConnection(state);
      });
    };
}
