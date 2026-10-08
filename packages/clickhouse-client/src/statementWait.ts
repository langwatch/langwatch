/**
 * One statement's wait bound and the refusal it turns into, shared by every limiter that admits
 * statements (the process-wide statement limit, the per-tenant gate) so they cannot drift.
 */

import type { AbortSignalLike } from "./query.ts";
import { QueueFullError } from "./rateLimit.ts";

declare const performance: { now(): number };
declare const AbortController: new () => { abort(): void; signal: AbortSignalLike };
declare const AbortSignal: { any(signals: AbortSignalLike[]): AbortSignalLike };
declare function setTimeout(callback: () => void, milliseconds: number): { unref?(): void };
declare function clearTimeout(timer: { unref?(): void }): void;

/** Where a refusal is logged. Structurally a subset of the managed client's logger. */
export interface StatementRefusalLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * A plain timer, armed only when the limiter being entered is full, so the unsaturated path
 * allocates no timer and no composed signal. Cleared at admission, unlike `AbortSignal.timeout`.
 */
export interface StatementWait {
  /** Arms the one timer, idempotently, when the limiter being entered is full. */
  armIfSaturated(isFull: boolean): void;
  /** The caller's signal until armed; composed with the timer's once armed. */
  readonly signal: AbortSignalLike | undefined;
  /** True only if this wait's own timer fired, never merely that the signal aborted. */
  hasTimedOut(): boolean;
  dispose(): void;
}

export function createStatementWait({
  signal,
  waitTimeoutMs,
}: {
  signal: AbortSignalLike | undefined;
  waitTimeoutMs: number;
}): StatementWait {
  let composed: AbortSignalLike | undefined;
  let timer: { unref?(): void } | undefined;
  let hasFired = false;

  const arm = () => {
    if (timer) return;
    const controller = new AbortController();
    composed =
      signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
    timer = setTimeout(() => {
      hasFired = true;
      controller.abort();
    }, waitTimeoutMs);
    // Nothing else running means nothing ahead of this statement to wait for.
    timer.unref?.();
  };

  return {
    armIfSaturated: (isFull) => {
      if (isFull) arm();
    },
    get signal() {
      return composed ?? signal;
    },
    hasTimedOut: () => hasFired,
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * What a statement that never got a slot surfaces: the overload error for a full queue or a wait
 * that ran out, `undefined` otherwise (rethrow the original). Once admitted, the statement's own
 * errors belong to the layers below, so a memory limit is never relabelled as overload.
 */
export function statementRefusal({
  error,
  isAdmitted,
  hasTimedOut,
  startedAt,
  waitTimeoutMs,
  logger,
  subject,
  logFields,
  createOverloadError,
  onShed,
}: {
  error: unknown;
  isAdmitted: boolean;
  hasTimedOut: boolean;
  startedAt: number;
  waitTimeoutMs: number;
  logger?: StatementRefusalLogger | undefined;
  /** What was refused, for the log line, e.g. "a ClickHouse statement". */
  subject: string;
  logFields: Record<string, unknown>;
  createOverloadError: (cause: unknown) => unknown;
  onShed?: (() => void) | undefined;
}): { refusal: unknown } | undefined {
  if (isAdmitted) return undefined;

  if (error instanceof QueueFullError) {
    onShed?.();
    logger?.warn(
      { ...logFields, maxQueued: error.maxQueued },
      `Refused ${subject}: concurrency wait queue full`,
    );
    return { refusal: createOverloadError(error) };
  }

  if (hasTimedOut) {
    onShed?.();
    logger?.warn(
      {
        ...logFields,
        waitedMs: Math.round(performance.now() - startedAt),
        timeoutMs: waitTimeoutMs,
      },
      `Refused ${subject}: waited too long for a slot`,
    );
    return { refusal: createOverloadError(error) };
  }

  return undefined;
}
