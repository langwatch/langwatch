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
