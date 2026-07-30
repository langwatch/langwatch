/**
 * The dispatch side of a process manager's outbox: what a handler receives,
 * and how it says "do not retry this".
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

/** `attempt` starts at 1; `messageKey` is the intent's own natural key. */
export interface IntentContext {
  readonly processName: string;
  readonly tenantId: string;
  readonly processKey: string;
  readonly messageKey: string;
  readonly attempt: number;
}

export type IntentHandler<Payload> = (
  payload: Payload,
  ctx: IntentContext,
) => Promise<void>;
