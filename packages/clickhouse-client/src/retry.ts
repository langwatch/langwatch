/**
 * Retrying a statement that failed for a reason worth trying again.
 *
 * Composes the policies in ./resilience.ts rather than restating them, so the
 * classifier this uses is the same one the outer job queue uses and the two
 * cannot drift into disagreeing about what "transient" means.
 *
 * {@link ClickHouseQueryClient} runs this *inside* the concurrency limiter, so
 * a retrying statement keeps its slot instead of rejoining the queue behind
 * fresh work.
 */

import type { AbortSignalLike, QueryRequest } from "./query";
import {
  isTransientClickHouseError,
  jitteredBackoffMs,
  retryNoticeLevel,
} from "./resilience";

export interface RetryNotice {
  /**
   * Absent when the policy was run without one — `run(task)` is a supported
   * form. Optional rather than cast away: a callback that reads tenant or table
   * off this would otherwise throw into runWithRetry's guard, and the retry
   * telemetry would vanish rather than fail loudly.
   */
  request?: QueryRequest | undefined;
  /** Zero-based. */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  /** `warn` for the first attempt, `debug` after: one failure, one warning. */
  level: "warn" | "debug";
}

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  /** Owned by the caller so this cannot drift from the queue's classifier. */
  transientMessageFragments?: readonly string[] | undefined;
  /** Injectable for deterministic tests. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  onRetry?: ((notice: RetryNotice) => void) | undefined;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Reached through `globalThis` so the package needs neither the Node nor the
 * DOM lib to build. Every host that can run a query has a timer.
 */
const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    (
      globalThis as unknown as {
        setTimeout: (fn: () => void, ms: number) => unknown;
      }
    ).setTimeout(resolve, ms);
  });

/** What {@link runWithRetry} reports on each retry. No request: it is generic. */
export interface RetryAttemptNotice {
  /** Zero-based. */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  /** `warn` for the first attempt, `debug` after: one failure, one warning. */
  level: "warn" | "debug";
}

export interface RunWithRetryOptions
  extends Omit<RetryOptions, "onRetry" | "transientMessageFragments"> {
  transientMessageFragments?: readonly string[] | undefined;
  onRetry?: ((notice: RetryAttemptNotice) => void) | undefined;
  /** Stop retrying once this reports true. Nobody is waiting any more. */
  isAborted?: (() => boolean) | undefined;
}

/**
 * Retry any operation under this package's policy.
 *
 * The loop lives here rather than in the client class so callers that are not
 * on the {@link ClickHouseQueryClient} port - `VendorClientResilience`, which
 * wraps the vendor client's own `query`/`insert`, and any host retrying
 * non-statement work - share one implementation instead of keeping a second
 * copy that drifts.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    transientMessageFragments,
    sleep = realSleep,
    random,
    onRetry,
    isAborted,
  }: RunWithRetryOptions = {},
): Promise<T> {
  // Without this, `maxAttempts: 0` never enters the loop and throws the
  // uninitialised `lastError` - an `undefined` with no message and no stack,
  // which every instanceof-based handler upstream misses.
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts - 1;
      const transient = isTransientClickHouseError({
        error,
        transientMessageFragments,
      });
      // An aborted caller is not waiting for the answer any more, so spending
      // the rest of the budget only adds load.
      if (!transient || isLastAttempt || isAborted?.() === true) {
        throw error;
      }

      const delayMs = jitteredBackoffMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        ...(random === undefined ? {} : { random }),
      });
      // Guarded because `onRetry` is host code - a logger, a counter - and it
      // runs inside the catch. An exception from it would propagate in place of
      // `error`, so the caller would be handed a logging failure and never
      // learn which ClickHouse error actually happened, and the remaining
      // attempts would be cancelled by the reporting of the failure rather than
      // the failure. Observability must not change what it observes.
      try {
        onRetry?.({
          attempt,
          maxAttempts,
          delayMs,
          error,
          level: retryNoticeLevel(attempt),
        });
      } catch {
        // Deliberately swallowed. There is nowhere better to put it: the only
        // channel for reporting it is the thing that just threw.
      }

      await sleep(delayMs);

      // Checked again after the wait, not only before it. A backoff can be
      // tens of seconds, and a caller that gave up during it is not waiting for
      // the answer any more, so another attempt is pure load.
      if (isAborted?.() === true) throw error;
    }
  }

  throw lastError;
}

/**
 * A configured retry policy, reusable across statements.
 *
 * Holds its options once instead of threading them through every call, which
 * is what lets the client hold one policy rather than rebuilding the argument
 * object per query.
 */
export class RetryPolicy {
  private readonly onRetry: ((notice: RetryNotice) => void) | undefined;
  private readonly options: Omit<RetryOptions, "onRetry">;

  constructor({ onRetry, ...options }: RetryOptions = {}) {
    this.onRetry = onRetry;
    this.options = options;
  }

  /**
   * Run `task`, retrying transient failures until the budget is spent.
   *
   * `request` is optional and only decorates the retry notice: a caller that
   * has one gets it echoed back for logging, and a caller retrying something
   * that is not a statement still gets the same backoff.
   */
  run<T>(
    task: () => Promise<T>,
    {
      signal,
      request,
    }: { signal?: AbortSignalLike | undefined; request?: QueryRequest | undefined } = {},
  ): Promise<T> {
    const onRetry = this.onRetry;
    // Falls back to the request's own signal. A caller that passes a request
    // carrying a signal and no explicit `signal` means for it to be honoured;
    // reading only the explicit one would silently retry work nobody is
    // waiting for, which is the exact failure this option exists to prevent.
    const abortSignal = signal ?? request?.signal;
    return runWithRetry(task, {
      ...this.options,
      isAborted: () => abortSignal?.aborted === true,
      ...(onRetry === undefined
        ? {}
        : {
            onRetry: (notice: Omit<RetryNotice, "request">) =>
              onRetry({ ...notice, request }),
          }),
    });
  }
}
