/**
 * The dispatch side of a process manager's outbox: how an intent's `deliver`
 * says "do not retry this".
 *
 * Default is retryable — most dispatch failures are transient. A
 * `TerminalDispatchError` retires the message as a logged drop instead of
 * spending the attempt budget on an outcome that cannot change (the trigger
 * is gone, every recipient is suppressed, the webhook URL is missing).
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
