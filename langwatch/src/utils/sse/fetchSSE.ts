import { fetchEventSource } from "@microsoft/fetch-event-source";
import { createLogger } from "~/utils/logger";
import { FetchSSETimeoutError } from "./errors";

const logger = createLogger("sseClient");
const EVENT_STREAM_CONTENT_TYPE = "text/event-stream";

export interface FetchSSEOptions<T> {
  /** Endpoint to connect to */
  endpoint: string;

  /** Payload to send with the request */
  payload: unknown;

  /** Function to handle each event */
  onEvent: (event: T) => void;

  /** Function to determine if processing should stop */
  shouldStopProcessing?: (event: T) => boolean;

  /** Timeout in milliseconds (default: 10_000) */
  timeout?: number;

  /** Timeout in milliseconds (default: 240_000) */
  chunkTimeout?: number;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Error handler */
  onError?: (error: Error) => void;
}

/**
 * Fetches data from an endpoint using SSE (Server-Sent Events)
 * and processes events through callbacks
 */
export async function fetchSSE<T>({
  endpoint,
  payload,
  onEvent,
  shouldStopProcessing,
  timeout = 10_000,
  chunkTimeout = 480_000,
  headers = {},
  onError,
}: FetchSSEOptions<T>): Promise<void> {
  // Wrap in a Promise so timeout errors can properly reject
  // instead of becoming unhandled exceptions
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let isSettled = false;

    const cleanup = () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };

    const handleError = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      if (onError) {
        onError(error);
        resolve();
      } else {
        reject(error);
      }
    };

    const setResetableTimeout = (timeoutMs: number) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const error = new FetchSSETimeoutError(
          `Connection timed out with timeout ${timeoutMs}ms waiting for the next event`,
        );
        logger.error(error);
        handleError(error);
      }, timeoutMs);
    };

    fetchEventSource(endpoint, {
      openWhenHidden: true,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,

      async onopen(response) {
        setResetableTimeout(timeout);

        if (
          response.ok &&
          response.headers
            .get("content-type")
            ?.includes(EVENT_STREAM_CONTENT_TYPE)
        ) {
          return;
        }

        const error = new Error(
          response.status >= 500
            ? `Server error: ${response.status} ${response.statusText}`
            : response.statusText,
        );
        handleError(error);
      },

      onmessage(ev) {
        setResetableTimeout(chunkTimeout);
        const event = JSON.parse(ev.data) as T;
        onEvent(event);

        if (shouldStopProcessing?.(event)) {
          if (!isSettled) {
            isSettled = true;
            cleanup();
            resolve();
          }
        }
      },

      onclose() {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          resolve();
        }
      },

      onerror(error) {
        handleError(error instanceof Error ? error : new Error(String(error)));
      },
    })
      .then(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          resolve();
        }
      })
      .catch((error) => {
        handleError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });
}
