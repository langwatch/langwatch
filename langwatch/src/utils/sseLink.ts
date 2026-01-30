import type { TRPCLink } from "@trpc/client";
import { TRPCClientError } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { createLogger } from "~/utils/logger";

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

const toTrpcError = <TRouter extends AnyRouter>(
  err: unknown,
  prefix: string,
) => {
  const msg = err instanceof Error ? err.message : String(err);
  return TRPCClientError.from<TRouter>(new Error(`${prefix}: ${msg}`));
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
        let es: EventSource | null = null;
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
          es?.close();
          es = null;
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
          if (closed) return;
          clearReconnectTimer();

          es?.close();
          es = null;

          const endpointUrl = buildUrl();
          logger.info(
            { path: endpointUrl.pathname, input: op.input },
            "Initiating SSE connection",
          );
          es = new EventSource(endpointUrl.toString(), eventSourceOptions);

          es.onopen = () => {
            reconnectAttempts = 0;
            logger.info({ path: endpointUrl.pathname }, "SSE connected");

            if (!closed && !startedSent) {
              startedSent = true;
              logger.debug(
                { path: endpointUrl.pathname },
                "SSE started event sent",
              );
              observer.next({ result: { type: "started" } });
            }
          };

          es.onmessage = (event) => {
            if (closed) return;

            try {
              const parsed = superjson.parse(event.data) as SSEMessage;

              if (isObject(parsed) && typeof parsed.type === "string") {
                if (parsed.type === "connected") {
                  logger.debug(
                    { path: endpointUrl.pathname },
                    "SSE connection acknowledged",
                  );
                  return;
                }
                if (parsed.type === "complete") {
                  logger.info(
                    { path: endpointUrl.pathname },
                    "SSE stream completed",
                  );
                  observer.complete();
                  close();
                  return;
                }
                if (parsed.type === "error") {
                  const msg =
                    typeof parsed.message === "string"
                      ? parsed.message
                      : "SSE Error";
                  logger.error(
                    { path: endpointUrl.pathname, error: msg },
                    "SSE error message received",
                  );
                  observer.error(TRPCClientError.from<TRouter>(new Error(msg)));
                  close();
                  return;
                }
              }

              logger.debug(
                { path: endpointUrl.pathname, dataType: typeof parsed },
                "SSE data message received",
              );
              observer.next({
                result: { type: "data", data: parsed as unknown },
              });
            } catch (error) {
              logger.error({ error }, "SSE message parse failed");
              observer.error(
                toTrpcError<TRouter>(error, "SSE message parsing failed"),
              );
              close();
            }
          };

          es.onerror = () => {
            if (closed) return;

            logger.warn(
              {
                readyState: es?.readyState,
                attempt: reconnectAttempts + 1,
                maxReconnectAttempts,
              },
              "SSE error",
            );

            es?.close();
            es = null;

            if (reconnectAttempts >= maxReconnectAttempts) {
              observer.error(
                TRPCClientError.from<TRouter>(
                  new Error(
                    `SSE connection failed after ${maxReconnectAttempts} attempts`,
                  ),
                ),
              );
              close();
              return;
            }

            reconnectAttempts += 1;
            const delay = reconnectDelay * Math.pow(2, reconnectAttempts - 1);
            logger.info(
              { attempt: reconnectAttempts, delay, path: endpointUrl.pathname },
              "Scheduling SSE reconnection",
            );
            reconnectTimer = setTimeout(() => !closed && connect(), delay);
          };
        };

        connect();
        return close;
      });
    };
}
