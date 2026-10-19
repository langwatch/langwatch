/**
 * An api process that is starting or draining answers with a plain-text 503 before any handler
 * runs (packages/process/src/server.ts) and marks it, so the call is sent again on another attempt.
 * Spec: specs/ui/api-unavailable-answer.feature
 */

export const UNAVAILABLE_MAX_ATTEMPTS = 5;
const DEFAULT_WAIT_MS = 1_000;
const MAX_WAIT_MS = 5_000;

/** Set by packages/process/src/server.ts only on refusals no handler saw, so a resend is safe. */
export const NOT_HANDLED_HEADER = "x-langwatch-not-handled";

/** A 503 that says the request never reached a handler; any other 503 may have run a write. */
function isLifecycleRefusal(response: Response): boolean {
  return response.status === 503 && response.headers.get(NOT_HANDLED_HEADER) !== null;
}

/** A plain-text 503 the client would fail to parse as JSON: the sentence becomes a tRPC error. */
function isPlainTextUnavailable(response: Response): boolean {
  if (response.status !== 503) return false;
  return (response.headers.get("content-type") ?? "").startsWith("text/plain");
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

/** Hands a 503 tRPC cannot parse over as JSON; every other answer passes through untouched. */
async function finalAnswer(response: Response): Promise<Response> {
  if (!isLifecycleRefusal(response) && !isPlainTextUnavailable(response)) return response;
  return asTrpcError({ sentence: (await response.text()).trim(), response });
}

/** Resends a call the api refused before any handler ran, then answers a JSON 503 tRPC can read. */
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
      const resend =
        isLifecycleRefusal(response) && attempt < maxAttempts && !init?.signal?.aborted;
      if (!resend) return finalAnswer(response);
      await response.body?.cancel();
      await sleep(waitMsOf(response));
    }
  };
}
