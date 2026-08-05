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

export function retry({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  transientMessageFragments,
  sleep = realSleep,
  random,
  onRetry,
}: RetryOptions = {}): QueryMiddleware {
  return (next) =>
    async <Row>(request: QueryRequest) => {
      let lastError: unknown;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await next<Row>(request);
        } catch (error) {
          lastError = error;

          const isLastAttempt = attempt === maxAttempts - 1;
          const transient = isTransientClickHouseError({
            error,
            transientMessageFragments,
          });
          // An aborted caller is not waiting for the answer any more, so
          // spending the rest of the budget only adds load.
          if (!transient || isLastAttempt || request.signal?.aborted === true) {
            throw error;
          }

          const delayMs = jitteredBackoffMs({
            attempt,
            baseDelayMs,
            maxDelayMs,
            ...(random === undefined ? {} : { random }),
          });
          onRetry?.({
            request,
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
    };
}
