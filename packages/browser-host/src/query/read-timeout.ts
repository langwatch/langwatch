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

/** Aborts when either the caller's signal or the time limit does. */
function eitherSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ReadTimeoutError(timeoutMs)), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (!signal) return controller.signal;
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller.signal;
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
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") return send(input, init);
    return send(input, { ...init, signal: eitherSignal(init?.signal, timeoutMs) });
  };
}
