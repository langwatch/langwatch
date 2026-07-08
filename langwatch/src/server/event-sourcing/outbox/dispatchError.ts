/**
 * Typed error thrown by outbox dispatch endpoints to signal whether the
 * failure is worth retrying.
 *
 * See dev/docs/adr/027-typed-dispatcherror-contract.md.
 *
 * Dispatch endpoints (alert dispatch, dataset append, etc.) should
 * catch provider/transport errors and re-throw as DispatchError with
 * an explicit `retryable` decision. The drainer interprets:
 *   - retryable: true  → schedule backoff retry (`failed_retryable`)
 *   - retryable: false → mark `dead`, surface to operator
 *
 * Any non-DispatchError thrown from a dispatch endpoint is treated as
 * retryable by default — better to retry an unexpected crash than to
 * silently dead-letter a row whose failure mode we did not classify.
 */
export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor({
    message,
    retryable,
    cause,
  }: {
    message: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(message);
    this.name = "DispatchError";
    this.retryable = retryable;
    this.cause = cause;
  }
}

export function isDispatchError(error: unknown): error is DispatchError {
  return error instanceof DispatchError;
}

/**
 * Whether an HTTP status warrants a retry, per ADR-027:
 *   - 429 (rate limited) and 5xx (server error) → retry with backoff
 *   - any other 4xx → terminal (revoked webhook, bad request, auth failure)
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Best-effort extraction of an HTTP status from the many error shapes the
 * dispatch providers raise (AWS SDK v3, axios/@slack/webhook, SendGrid, fetch).
 * Returns undefined for transport errors (ECONNREFUSED, ETIMEDOUT, …) that
 * carry no HTTP status — those are treated as retryable by the caller.
 *
 * Note `code` is only read when numeric: SendGrid uses a numeric `code` for the
 * status, whereas Node transport errors and @slack/webhook use a string `code`.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, any>;
  const candidates = [
    e.$metadata?.httpStatusCode,
    e.response?.status,
    e.response?.statusCode,
    e.statusCode,
    e.status,
    e.original?.response?.status,
    e.original?.response?.statusCode,
    typeof e.code === "number" ? e.code : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate >= 100 && candidate < 600) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Converts a raw dispatch failure into a DispatchError with a retryable
 * decision derived from its HTTP status. An already-typed DispatchError is
 * returned unchanged. Failures with no recognizable status default to
 * retryable — see ADR-027 for why the unknown case is conservative.
 *
 * When the caller knows the failure cannot be retried (e.g. a template
 * render failure where the payload itself is malformed), it can pass
 * `retryable: false` to short-circuit the HTTP-status heuristic and
 * promote the row straight to `dead`.
 */
export function toDispatchError(
  error: unknown,
  {
    message,
    retryable: retryableOverride,
  }: { message: string; retryable?: boolean },
): DispatchError {
  if (isDispatchError(error)) return error;
  if (retryableOverride !== undefined) {
    return new DispatchError({
      message,
      retryable: retryableOverride,
      cause: error,
    });
  }
  const status = extractHttpStatus(error);
  const retryable = status === undefined ? true : isRetryableHttpStatus(status);
  return new DispatchError({ message, retryable, cause: error });
}
