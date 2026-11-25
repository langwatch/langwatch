import { type AbortSignalLike, QueueFullError } from "./rateLimit.ts";

declare const performance: { now(): number };
declare const AbortController: new () => { abort(): void; signal: AbortSignalLike };
declare const AbortSignal: { any(signals: AbortSignalLike[]): AbortSignalLike };
declare function setTimeout(callback: () => void, milliseconds: number): { unref?(): void };
declare function clearTimeout(timer: { unref?(): void }): void;

/**
 * One statement's wait bound, armed lazily and at most once across every limiter it enters. A
 * plain timer, cleared at admission, so the unsaturated path allocates nothing and a test can
 * fake it. `hasTimedOut` is true only when this timer fired, never for the caller's own abort.
 */
export class StatementWait {
  private composed: AbortSignalLike | undefined;
  private timer: { unref?(): void } | undefined;
  private fired = false;
  private readonly callerSignal: AbortSignalLike | undefined;
  private readonly timeoutMs: number;

  constructor({ signal, timeoutMs }: { signal: AbortSignalLike | undefined; timeoutMs: number }) {
    this.callerSignal = signal;
    this.timeoutMs = timeoutMs;
  }

  get signal(): AbortSignalLike | undefined {
    return this.composed ?? this.callerSignal;
  }

  armIf(isFull: boolean): void {
    if (!isFull || this.timer !== undefined) return;
    const controller = new AbortController();
    this.composed =
      this.callerSignal === undefined
        ? controller.signal
        : AbortSignal.any([this.callerSignal, controller.signal]);
    this.timer = setTimeout(() => {
      this.fired = true;
      controller.abort();
    }, this.timeoutMs);
    this.timer.unref?.();
  }

  hasTimedOut(): boolean {
    return this.fired;
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }
}

/**
 * What a statement that never got a slot throws: the overload error, counted as shed, when the
 * queue was full or the wait timed out; otherwise its own error (a caller's abort stays one).
 */
export function statementRefusal({
  error,
  timedOut,
  startedAt,
  timeoutMs,
  subject,
  logFields,
  logger,
  onShed,
  createOverload,
}: {
  error: unknown;
  timedOut: boolean;
  startedAt: number;
  timeoutMs: number;
  subject: string;
  logFields: Record<string, unknown>;
  logger: { warn(fields: Record<string, unknown>, message: string): void } | undefined;
  onShed: () => void;
  createOverload: (input: { cause: unknown }) => unknown;
}): unknown {
  if (error instanceof QueueFullError) {
    onShed();
    logger?.warn(
      { ...logFields, maxQueued: error.maxQueued },
      `Refused ${subject}: concurrency wait queue full`,
    );
    return createOverload({ cause: error });
  }
  if (timedOut) {
    onShed();
    logger?.warn(
      { ...logFields, waitedMs: Math.round(performance.now() - startedAt), timeoutMs },
      `Refused ${subject}: waited too long for a slot`,
    );
    return createOverload({ cause: error });
  }
  return error;
}
