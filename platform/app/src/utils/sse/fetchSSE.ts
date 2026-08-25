import { createLogger } from "@langwatch/observability";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { explainSerializedError } from "~/features/errors/logic/presentation";
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

  /**
   * Cancels the stream from the outside — a Stop button, or a component
   * unmounting mid-run. The server treats the disconnect as the cancel signal.
   */
  signal?: AbortSignal;
}

/**
 * Reads the sentence a refused request came back with.
 *
 * Two body shapes reach here. Routes on `@langwatch/api` answer with a coded
 * envelope whose wire `message` is deliberately the code slug, so the words
 * come from the client error registry, keyed by `code`. Legacy SecuredApp
 * routes answer `{ error }` — a dataset still normalising (425), a node with
 * no model (422) — and that sentence is the one telling the user what to fix.
 * Falling back to `statusText` reduced every one of them to "Unprocessable
 * Entity".
 */
async function describeRefusal(response: Response): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; error?: unknown } | null;

  if (typeof body?.code === "string") {
    const explained = explainSerializedError(
      body as Parameters<typeof explainSerializedError>[0],
    );
    return explained.description || explained.title;
  }

  if (typeof body?.error === "string") return body.error;

  return response.status >= 500
    ? `Server error: ${response.status} ${response.statusText}`
    : response.statusText;
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
  signal,
}: FetchSSEOptions<T>): Promise<void> {
  // Wrap in a Promise so timeout errors can properly reject
  // instead of becoming unhandled exceptions
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const abortFromSignal = () => controller.abort();
    let timeoutId: NodeJS.Timeout | undefined;
    let isSettled = false;

    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", abortFromSignal, { once: true });

    const cleanup = () => {
      // The caller owns `signal` and outlives this request. Without the removal
      // a settled stream's controller is retained until the caller aborts.
      signal?.removeEventListener("abort", abortFromSignal);
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

        handleError(new Error(await describeRefusal(response)));
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
        handleError(toError(error));
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
        handleError(toError(error));
      });
  });
}
