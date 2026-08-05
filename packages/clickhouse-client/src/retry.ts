/**
 * Retry middleware.
 *
 * Composes the policies in ./resilience.ts rather than restating them, so the
 * classifier this uses is the same one the outer job queue uses and the two
 * cannot drift into disagreeing about what "transient" means.
 *
 * Compose this *inside* the rate limiter, so a retrying statement keeps its
 * slot instead of rejoining the queue behind fresh work.
 */

import type { QueryMiddleware, QueryRequest } from "./pipeline";
import {
  isTransientClickHouseError,
  jitteredBackoffMs,
  retryNoticeLevel,
} from "./resilience";

export interface RetryNotice {
  request: QueryRequest;
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
 * The loop lives here rather than in the middleware so a caller that is not
 * yet on the pipeline - the app's `ResilientClickHouseClient`, which wraps the
 * vendor client's own `query`/`insert` - can share one implementation instead
 * of keeping a second copy that drifts.
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
      onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error,
        level: retryNoticeLevel(attempt),
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function retry({
  onRetry,
  ...options
}: RetryOptions = {}): QueryMiddleware {
  return (next) =>
    <Row>(request: QueryRequest) =>
      runWithRetry(() => next<Row>(request), {
        ...options,
        isAborted: () => request.signal?.aborted === true,
        ...(onRetry === undefined
          ? {}
          : { onRetry: (notice) => onRetry({ ...notice, request }) }),
      });
}
