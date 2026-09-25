import { toError } from "@langwatch/browser-host/errors";
import { explainSerializedError } from "@langwatch/error-presentation/presentation";
import { createLogger } from "@langwatch/observability/browser";
import { fetchEventSource } from "@microsoft/fetch-event-source";

import { FetchSSETimeoutError } from "./errors.ts";

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
 * Handles both modern coded envelopes and legacy error responses.
 */
async function describeRefusal(response: Response): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; error?: unknown } | null;

  if (typeof body?.code === "string") {
    const explained = explainSerializedError(body as Parameters<typeof explainSerializedError>[0]);
    return explained.description || explained.title;
  }

  if (typeof body?.error === "string") return body.error;

  return response.status >= 500
    ? `Server error: ${response.status} ${response.statusText}`
    : response.statusText;
}

/** One SSE request's lifetime: it settles once, on the first of finish, failure or timeout. */
class SseRequest {
  readonly controller = new AbortController();
  private timeoutId: ReturnType<typeof setTimeout> | undefined;
  private settled = false;
  private readonly abortFromSignal = () => this.controller.abort();

  static create(input: {
    signal?: AbortSignal;
    resolve: () => void;
    reject: (error: Error) => void;
    onError?: (error: Error) => void;
  }): SseRequest {
    const request = new SseRequest(input);
    input.signal?.addEventListener("abort", request.abortFromSignal, { once: true });
    return request;
  }

  private constructor(
    private readonly input: {
      signal?: AbortSignal;
      resolve: () => void;
      reject: (error: Error) => void;
      onError?: (error: Error) => void;
    },
  ) {}

  finish(): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.input.resolve();
  }

  fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    if (this.input.onError) {
      this.input.onError(error);
      this.input.resolve();
    } else {
      this.input.reject(error);
    }
  }

  waitForNextEvent(timeoutMs: number): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      const error = new FetchSSETimeoutError(
        `Connection timed out with timeout ${timeoutMs}ms waiting for the next event`,
      );
      logger.error(error);
      this.fail(error);
    }, timeoutMs);
  }

  /** The caller owns `signal` and outlives this request, so its listener is removed here. */
  private cleanup(): void {
    this.input.signal?.removeEventListener("abort", this.abortFromSignal);
    this.controller.abort();
    if (this.timeoutId) clearTimeout(this.timeoutId);
  }
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
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const request = SseRequest.create({ signal, resolve, reject, onError });

    fetchEventSource(endpoint, {
      openWhenHidden: true,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: request.controller.signal,

      async onopen(response) {
        request.waitForNextEvent(timeout);

        if (
          response.ok &&
          response.headers.get("content-type")?.includes(EVENT_STREAM_CONTENT_TYPE)
        ) {
          return;
        }

        request.fail(new Error(await describeRefusal(response)));
      },

      onmessage(ev) {
        request.waitForNextEvent(chunkTimeout);
        const event = JSON.parse(ev.data) as T;
        onEvent(event);

        if (shouldStopProcessing?.(event)) request.finish();
      },

      onclose() {
        request.finish();
      },

      onerror(error) {
        request.fail(toError(error));
      },
    })
      .then(() => request.finish())
      .catch((error) => request.fail(toError(error)));
  });
}
