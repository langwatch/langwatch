/**
 * Bounded concurrency, with shedding.
 *
 * Pool sizing bounds how many sockets a process may open. It does not bound how
 * many statements the process will try to run: work arrives from a queue whose
 * concurrency is set somewhere else entirely, and on a bad day every lane wants
 * the server at once. That is the shape of the 2026-07-31 incident - the server
 * hit `max_concurrent_queries`, rejected, the rejections were classified as
 * transient, and the retries went back into the same wall.
 *
 * Two rules follow, and they are the reason this exists as a separate layer
 * rather than a flag on the retry policy:
 *
 *  - A slot is held across retries, not taken per attempt. Compose this
 *    *outside* retry. Inside, a retrying statement releases its slot, joins the
 *    back of the queue, and competes with fresh work, which is how a queue
 *    turns a small overload into a persistent one.
 *
 *  - The waiting queue is bounded and sheds when full. An unbounded wait queue
 *    does not prevent overload, it hides it: the server stays inside its limit
 *    while memory grows and latency climbs until something upstream times out.
 *    Refusing immediately is worse for one caller and much better for the rest.
 */

import type { AbortSignalLike, QueryMiddleware } from "./pipeline";

/** Raised when the wait queue is full. Shed load rather than grow it. */
export class QueueFullError extends Error {
  constructor(public readonly maxQueued: number) {
    super(
      `ClickHouse concurrency queue is full (${maxQueued} waiting). Shedding rather than queueing further.`,
    );
    this.name = "QueueFullError";
  }
}

/** Raised when a caller's signal aborts while it is still waiting for a slot. */
export class AcquireAbortedError extends Error {
  constructor() {
    super("Aborted while waiting for a ClickHouse concurrency slot.");
    this.name = "AcquireAbortedError";
  }
}

export interface ConcurrencyLimiterOptions {
  /** Statements allowed to be in flight at once. */
  maxConcurrent: number;
  /** Callers allowed to wait. Beyond this, `run` rejects immediately. */
  maxQueued?: number | undefined;
}

export interface LimiterStats {
  inFlight: number;
  queued: number;
}

export interface ConcurrencyLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignalLike): Promise<T>;
  stats(): LimiterStats;
}

const DEFAULT_MAX_QUEUED = 1_000;

export function createConcurrencyLimiter({
  maxConcurrent,
  maxQueued = DEFAULT_MAX_QUEUED,
}: ConcurrencyLimiterOptions): ConcurrencyLimiter {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("maxConcurrent must be a positive integer");
  }
  // Zero is a real setting - never queue, shed the moment the slots are gone.
  // A non-integer is not: `waiting.length >= NaN` is false forever, which
  // unbounds the queue and quietly removes the only thing this module is for.
  if (!Number.isInteger(maxQueued) || maxQueued < 0) {
    throw new RangeError("maxQueued must be a non-negative integer");
  }

  let inFlight = 0;
  const waiting: { release: () => void; abort: (error: Error) => void }[] = [];

  const pump = (): void => {
    if (inFlight >= maxConcurrent) return;
    const next = waiting.shift();
    if (next === undefined) return;
    inFlight += 1;
    next.release();
  };

  const acquire = (signal?: AbortSignalLike): Promise<void> => {
    if (signal?.aborted === true) {
      return Promise.reject(new AcquireAbortedError());
    }
    if (inFlight < maxConcurrent) {
      inFlight += 1;
      return Promise.resolve();
    }
    if (waiting.length >= maxQueued) {
      return Promise.reject(new QueueFullError(maxQueued));
    }

    return new Promise<void>((resolve, reject) => {
      const entry = {
        release: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        abort: (error: Error) => reject(error),
      };
      const onAbort = () => {
        const index = waiting.indexOf(entry);
        // Already released: the task is starting, so the abort is the task's
        // problem now, not the queue's.
        if (index === -1) return;
        waiting.splice(index, 1);
        entry.abort(new AcquireAbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(entry);
    });
  };

  return {
    async run(task, signal) {
      await acquire(signal);
      try {
        return await task();
      } finally {
        inFlight -= 1;
        pump();
      }
    },
    stats: () => ({ inFlight, queued: waiting.length }),
  };
}

/**
 * Middleware form. Compose outside retry so a slot is held for the whole
 * statement, retries included.
 */
export function rateLimit({
  limiter,
}: {
  limiter: ConcurrencyLimiter;
}): QueryMiddleware {
  return (next) => (request) =>
    limiter.run(() => next(request), request.signal);
}
