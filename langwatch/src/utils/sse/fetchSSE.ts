import { fetchEventSource } from "@microsoft/fetch-event-source";
import { RetriableError, FatalError } from "./errors";
import { createLogger } from "~/utils/logger";

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
  // Create abort controller for manual termination
  const controller = new AbortController();

  // Set timeout to prevent hanging connections
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

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

      // Validate the response when the connection is established
      async onopen(response) {
        clearTimeout(timeoutId);

        if (
          response.ok &&
          response.headers
            .get("content-type")
            ?.includes(EVENT_STREAM_CONTENT_TYPE)
        ) {
          return; // Connection established successfully
        } else if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          // Client-side errors are usually non-retriable
          let errorMessage: string;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || response.statusText;
          } catch (parseError) {
            errorMessage = response.statusText;
            logger.error(
              {
                error: parseError,
                status: response.status,
                statusText: response.statusText,
              },
              "Failed to parse error response as JSON"
            );
          }
          throw new FatalError(errorMessage);
        } else {
          // Server errors might be temporary, mark as retriable
          throw new RetriableError(
            `Server error: ${response.status} ${response.statusText}`
          );
        }
      },

      // Process incoming messages
      onmessage(ev) {
        try {
          // Reset the timeout on each message
          clearTimeout(timeoutId);

          const event = JSON.parse(ev.data) as T;
          logger.debug({ event }, "Received server event");

          // Pass the event to the handler
          onEvent(event);

          // Check if we should stop processing
          if (shouldStopProcessing && shouldStopProcessing(event)) {
            controller.abort();
          }
        } catch (error) {
          if (error instanceof FatalError) {
            throw error; // Rethrow fatal errors
          }
          // Log parsing errors but continue processing
          logger.error({ error, data: ev.data }, "Error parsing SSE event");
        }
      },

      // Handle unexpected connection closure
      onclose() {
        clearTimeout(timeoutId);
      },

      // Handle errors during the connection
      onerror(err) {
        clearTimeout(timeoutId);

        if (err instanceof FatalError) {
          throw err; // Rethrow fatal errors to stop the operation
        } else if (err instanceof RetriableError) {
          logger.warn({ error: err }, "Retriable error occurred");
          // Log and propagate
          throw err;
        } else {
          logger.error({ error: err }, "Unknown error during SSE processing");
          throw err; // Rethrow unknown errors
        }
      },
    });
  } catch (error) {
    // Handle errors from the fetchEventSource
    clearTimeout(timeoutId);

    if (onError) {
      onError(error instanceof Error ? error : new Error(String(error)));
    } else {
      throw error;
    }
  }
}
