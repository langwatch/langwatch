import { fetchEventSource } from "@microsoft/fetch-event-source";
import { createLogger } from "~/utils/logger";
import { FetchSSETimeoutError, Timeout } from "./errors";

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

  /** Timeout in milliseconds (default: 20000) */
  timeout?: number;

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
  timeout = 20000,
  headers = {},
  onError,
}: FetchSSEOptions<T>): Promise<void> {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;

  const cleanup = () => {
    controller.abort();
    if (timeoutId) clearTimeout(timeoutId);
  };

  const setResetableTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      cleanup();
      const error = new FetchSSETimeoutError(
        `fetchSSE timed out with timeout ${timeout}ms`
      );
      logger.error(error);
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }, timeout);
  };

  try {
    await fetchEventSource(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,

      async onopen(response) {
        setResetableTimeout();

        if (
          response.ok &&
          response.headers
            .get("content-type")
            ?.includes(EVENT_STREAM_CONTENT_TYPE)
        ) {
          return;
        }

        // All errors are treated the same - they'll be caught by the main try-catch
        throw new Error(
          response.status >= 500
            ? `Server error: ${response.status} ${response.statusText}`
            : response.statusText
        );
      },

      onmessage(ev) {
        setResetableTimeout();
        const event = JSON.parse(ev.data) as T;
        onEvent(event);

        if (shouldStopProcessing?.(event)) {
          cleanup();
        }
      },

      onclose() {
        cleanup();
      },

      onerror(error) {
        cleanup();
        throw error; // Propagate to main try-catch
      },
    });
  } catch (error) {
    const processedError =
      error instanceof Error ? error : new Error(String(error));

    cleanup();

    if (onError) {
      onError(processedError);
    } else {
      throw processedError;
    }
  }
}
