/**
 * A time limit on the browser's reads. A request the network swallows never fails on its own, so
 * a read without one waits forever and the retry policy (query-retry.ts) never gets its turn.
 * Spec: specs/ui/read-timeout.feature
 */

/**
 * Above the API's own limit on a read: ClickHouse requests give up after 30 s
 * (DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS), so the server answers every read it can before this.
 */
export const UI_READ_TIMEOUT_MS = 45_000;

/** The reason a read that ran out of time carries, so a log can tell it from a cancel. */
export class ReadTimeoutError extends Error {
  override readonly name = "ReadTimeoutError";

  constructor(timeoutMs: number) {
    super(`The API did not answer this read within ${timeoutMs / 1000} s`);
  }
}

/**
 * A signal that aborts when either the caller's does or the time limit runs out, and `release`,
 * which drops the timer and the listener on the caller's signal once the read's body has ended: a
 * long-lived caller signal must not collect one listener per read.
 */
function eitherSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ReadTimeoutError(timeoutMs)), timeoutMs);
  const follow = () => controller.abort(signal?.reason);
  if (signal?.aborted) follow();
  else signal?.addEventListener("abort", follow, { once: true });
  const release = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", follow);
  };
  return { signal: controller.signal, release };
}

/**
 * A fetch that gives up on a GET after `timeoutMs`. tRPC sends queries as GET and mutations as
 * POST; only a read is limited, since a write the server may still apply must not be sent twice.
 */
export function readTimeoutFetch({
  fetch,
  timeoutMs = UI_READ_TIMEOUT_MS,
}: {
  /** The fetch to send on. Defaults to the browser's, looked up per call. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
} = {}): typeof globalThis.fetch {
  return (input, init) => {
    const send = fetch ?? globalThis.fetch;
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (method !== "GET") return send(input, init);
    // An explicit `init.signal` replaces the Request's own, so the Request's is carried over.
    const limited = eitherSignal(init?.signal ?? request?.signal, timeoutMs);
    return send(input, { ...init, signal: limited.signal }).then(
      (response) => releasedWithBody({ response, release: limited.release }),
      (error: unknown) => {
        limited.release();
        throw error;
      },
    );
  };
}

/**
 * Headers can arrive long before the body, so the limit and the caller's cancel stay on until the
 * body ends: an error (the abort among them) needs no release, since the timer can only abort a
 * read that is already over.
 */
function releasedWithBody({
  response,
  release,
}: {
  response: Response;
  release: () => void;
}): Response {
  if (!response.body) {
    release();
    return response;
  }
  const body = response.body.pipeThrough(new TransformStream({ flush: release }));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
