/**
 * Bounded concurrency, with shedding. A slot is held across retries, not
 * per attempt — else a retrying statement escapes the bound. The wait
 * queue sheds when full, since unbounded hides overload instead of preventing it.
 */

import type { AbortSignalLike } from "./query.ts";

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

const DEFAULT_MAX_QUEUED = 1_000;

/**
 * Bounded concurrency with a bounded wait queue. A class rather than a
 * closure since it holds this package's one piece of mutable state —
 * in-flight count and waiters — readable from a test via {@link stats}.
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private inFlight = 0;
  private readonly waiting: {
    release: () => void;
    abort: (error: Error) => void;
  }[] = [];

  constructor({ maxConcurrent, maxQueued = DEFAULT_MAX_QUEUED }: ConcurrencyLimiterOptions) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a positive integer");
    }
    // Zero is a real setting - never queue, shed the moment the slots are gone.
    // A non-integer is not: `waiting.length >= NaN` is false forever, which
    // unbounds the queue and quietly removes the only thing this class is for.
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError("maxQueued must be a non-negative integer");
    }
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
  }

  /** Run `task` once a slot is free, releasing the slot when it settles. */
  async run<T>({
    task,
    signal,
  }: {
    task: () => Promise<T>;
    signal?: AbortSignalLike | undefined;
  }): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.inFlight -= 1;
      this.pump();
    }
  }

  stats(): LimiterStats {
    return { inFlight: this.inFlight, queued: this.waiting.length };
  }

  private pump(): void {
    if (this.inFlight >= this.maxConcurrent) return;
    const next = this.waiting.shift();
    if (next === undefined) return;
    this.inFlight += 1;
    next.release();
  }

  private acquire(signal?: AbortSignalLike): Promise<void> {
    if (signal?.aborted === true) {
      return Promise.reject(new AcquireAbortedError());
    }
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new QueueFullError(this.maxQueued));
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
        const index = this.waiting.indexOf(entry);
        // Already released: the task is starting, so the abort is the task's
        // problem now, not the queue's.
        if (index === -1) return;
        this.waiting.splice(index, 1);
        entry.abort(new AcquireAbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }
}
