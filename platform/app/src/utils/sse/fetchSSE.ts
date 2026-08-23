import { createLogger } from "@langwatch/observability";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { explainSerializedError } from "~/features/errors/logic/presentation";
import { toError } from "~/utils/posthogErrorCapture";
import { FetchSSEIncompleteStreamError, FetchSSETimeoutError } from "./errors";

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

  /**
   * Treats a stream that ends without `shouldStopProcessing` ever matching as
   * a failure rather than a completed run.
   *
   * Off by default, because for most callers the close IS the end. Turn it on
   * where the protocol has an explicit terminator: without it, a server that
   * dies after a delta looks identical to one that finished, and the caller
   * persists a truncated reply as a successful one.
   */
  requireCompletion?: boolean;

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
  requireCompletion = false,
}: FetchSSEOptions<T>): Promise<void> {
  // Wrap in a Promise so timeout errors can properly reject
  // instead of becoming unhandled exceptions
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let isSettled = false;
    // Whether `shouldStopProcessing` ever matched, i.e. whether the stream
    // reached its own terminator rather than merely stopping.
    let completed = false;

    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    const cleanup = () => {
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };

    const handleError = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      // A caller that aborted got what it asked for. Reporting the resulting
      // AbortError as a failure made "stop" look like the run had broken.
      if (signal?.aborted) {
        resolve();
        return;
      }
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

    // Armed before the request, not in `onopen`. An endpoint that accepts the
    // connection and never sends response headers left no timer running at
    // all, so the caller waited for as long as the user let it.
    setResetableTimeout(timeout);

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
          completed = true;
          if (!isSettled) {
            isSettled = true;
            cleanup();
            resolve();
          }
        }
      },

      onclose() {
        if (isSettled) return;
        if (requireCompletion && !completed && !signal?.aborted) {
          handleError(
            new FetchSSEIncompleteStreamError(
              "The stream closed before the run completed",
            ),
          );
          return;
        }
        isSettled = true;
        cleanup();
        resolve();
      },

      onerror(error) {
        handleError(toError(error));
      },
    })
      .then(() => {
        if (isSettled) return;
        if (requireCompletion && !completed && !signal?.aborted) {
          handleError(
            new FetchSSEIncompleteStreamError(
              "The stream closed before the run completed",
            ),
          );
          return;
        }
        isSettled = true;
        cleanup();
        resolve();
      })
      .catch((error) => {
        handleError(toError(error));
      });
  });
}
