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

import type { AbortSignalLike } from "./query";

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
 * Bounded concurrency with a bounded wait queue.
 *
 * A class rather than a closure because it is the one thing in this package
 * that holds mutable state — how many statements are in flight, and who is
 * waiting — and that state is worth naming. It also makes the state readable
 * from a test through {@link stats} without the test having to run a statement.
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private inFlight = 0;
  private readonly waiting: {
    release: () => void;
    abort: (error: Error) => void;
  }[] = [];

  constructor({
    maxConcurrent,
    maxQueued = DEFAULT_MAX_QUEUED,
  }: ConcurrencyLimiterOptions) {
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
