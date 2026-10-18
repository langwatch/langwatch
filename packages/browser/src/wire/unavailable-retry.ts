/**
 * An api process that is starting or draining answers with a plain-text 503 before any handler
 * runs (packages/process/src/server.ts), so the call is sent again on another attempt.
 * Spec: specs/ui/api-unavailable-answer.feature
 */

export const UNAVAILABLE_MAX_ATTEMPTS = 5;
const DEFAULT_WAIT_MS = 1_000;
const MAX_WAIT_MS = 5_000;

/** The process lifecycle answer: a 503 whose body is a sentence, not a handler's JSON. */
function isLifecycleRefusal(response: Response): boolean {
  if (response.status !== 503) return false;
  const type = response.headers.get("content-type") ?? "";
  return type.startsWith("text/plain");
}

function waitMsOf(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_WAIT_MS;
  return Math.min(seconds * 1000, MAX_WAIT_MS);
}

/** The tRPC error envelope, so the client reads a 503 rather than failing to parse the sentence. */
function asTrpcError({ sentence, response }: { sentence: string; response: Response }): Response {
  const body = {
    error: {
      message: sentence || "The API is unavailable",
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 503,
    statusText: response.statusText,
    headers: { "content-type": "application/json" },
  });
}

export function unavailableRetryFetch({
  fetch,
  maxAttempts = UNAVAILABLE_MAX_ATTEMPTS,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  /** The fetch to send on. Defaults to the browser's, looked up per call. */
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
} = {}): typeof globalThis.fetch {
  return async (input, init) => {
    const send = fetch ?? globalThis.fetch;
    for (let attempt = 1; ; attempt++) {
      // A Request's body is read once, so each attempt sends its own copy.
      const response = await send(input instanceof Request ? input.clone() : input, init);
      if (!isLifecycleRefusal(response)) return response;
      if (attempt >= maxAttempts || init?.signal?.aborted) {
        return asTrpcError({ sentence: (await response.text()).trim(), response });
      }
      await response.body?.cancel();
      await sleep(waitMsOf(response));
    }
  };
}
