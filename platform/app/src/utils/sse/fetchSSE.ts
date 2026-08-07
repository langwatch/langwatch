import { createLogger } from "@langwatch/observability";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { toError } from "~/utils/posthogErrorCapture";
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

interface SSESettlement {
  /** Abort signal for the underlying request; aborted by every settle path. */
  signal: AbortSignal;
  /** Settles the stream successfully, once. */
  settle: () => void;
  /** Settles the stream as a failure, once, honouring the caller's onError. */
  handleError: (error: Error) => void;
  /** (Re)arms the inactivity timer that fails the stream when it lapses. */
  setResetableTimeout: (timeoutMs: number) => void;
}

/**
 * Owns the one-shot settlement of the wrapping Promise: the abort controller,
 * the inactivity timer, and the guard that keeps the first outcome the only one.
 */
function createSSESettlement({
  resolve,
  reject,
  onError,
}: {
  resolve: (value: void | PromiseLike<void>) => void;
  reject: (reason?: unknown) => void;
  onError?: (error: Error) => void;
}): SSESettlement {
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

  const settle = () => {
    if (isSettled) return;
    isSettled = true;
    cleanup();
    resolve();
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

  return {
    signal: controller.signal,
    settle,
    handleError,
    setResetableTimeout,
  };
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
    const { signal, settle, handleError, setResetableTimeout } =
      createSSESettlement({ resolve, reject, onError });

    fetchEventSource(endpoint, {
      openWhenHidden: true,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal,

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
          settle();
        }
      },

      onclose() {
        settle();
      },

      onerror(error) {
        handleError(toError(error));
      },
    })
      .then(() => {
        settle();
      })
      .catch((error) => {
        handleError(toError(error));
      });
  });
}
