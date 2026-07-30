/**
 * The process outbox's retry doctrine (ADR-098), restated locally because the
 * executor that will read this classification does not exist yet — see
 * `process-managers/processManager.types.ts`.
 *
 * Default is retryable: a plain thrown error from an intent handler retries
 * on the outbox's attempt budget, because most dispatch failures — a
 * provider timeout, a transient database error — should. `TerminalDispatchError`
 * is the explicit opt-out for the failures a handler already knows are
 * pointless to repeat: the trigger no longer exists, every recipient is
 * suppressed, the webhook URL is missing. Throwing this instead of a plain
 * `Error` tells the (future) outbox to retire the message as a logged drop
 * rather than spend its attempt budget on an outcome that cannot change.
 *
 * This mirrors the old pipeline's `DispatchError.retryable` flag without
 * importing it — `event-sourcing.old` is read-only reference for this
 * rewrite, never a dependency of the new pipeline.
 */
export class TerminalDispatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TerminalDispatchError";
  }
}

export function isTerminalDispatchError(
  error: unknown,
): error is TerminalDispatchError {
  return error instanceof TerminalDispatchError;
}
