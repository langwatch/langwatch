// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Shared HTTP fetch-with-retry for puller adapters.
 *
 * Lifted out of HttpPollingPullerAdapter so the Management Activity API
 * adapter can reuse it without extending that class. Its subscribe / list /
 * drain shape does not fit a single paginated URL, so it implements
 * PullerAdapter directly — which would otherwise mean copy-pasting this
 * logic, and a retry path that exists twice drifts.
 *
 * Behaviour, in the order the checks run:
 *
 *   2xx           returned to the caller
 *   429           retried, honouring Retry-After when present
 *   5xx           retried on the fixed backoff schedule
 *   other 4xx     thrown immediately, never retried
 *   transport     retried on the fixed backoff schedule
 *
 * Adding 429 changes two adapters that already shipped: `http_custom` and
 * `claude_compliance` previously treated 429 as a plain 4xx and failed fast.
 * They now wait and retry. The deadline guard below is what keeps that from
 * turning a visible error into a silent timeout — a wait that would outlive
 * the run does not happen at all.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

import type { Response as FetchResponse } from "undici";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

/** Backoff for 5xx and transport errors. Two retries, then give up. */
export const RETRY_DELAYS_MS = [250, 500] as const;

/** Per-request bound, independent of the run's deadline. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ceiling on a server-supplied Retry-After. A cooperative server asking for
 * a longer wait than any single run may last is telling us to come back on
 * the next run, not to sleep through this one.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Thrown when the only way forward is a wait that outlives the run.
 *
 * Distinct from a failure: nothing is wrong, there is just no point sleeping
 * past a deadline the scheduler has already stopped waiting on. Adapters
 * catch this and return their cursor so the next run resumes, rather than
 * reporting an error.
 */
export class RetryDeadlineExceededError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(
      `Retry would outlive the run deadline (needs ${retryAfterMs}ms). ` +
        `Returning so the cursor can be persisted for the next run.`,
    );
    this.name = "RetryDeadlineExceededError";
    this.retryAfterMs = retryAfterMs;
  }
}

export interface FetchWithRetryOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** The run's abort signal. Aborting stops retrying immediately. */
  signal?: AbortSignal;
  /**
   * Epoch ms after which no further waiting is allowed. Omit when the caller
   * has no deadline; `signal` still bounds the run.
   */
  deadlineAtMs?: number;
  /** Injectable for tests, so retry behaviour is provable without real waits. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Parse a Retry-After header. The spec allows delta-seconds or an HTTP-date;
 * both appear in the wild. Returns null when absent or unparseable, which
 * puts the caller on the normal backoff schedule rather than failing.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number,
): number | null {
  if (headerValue == null) return null;
  const trimmed = headerValue.trim();
  if (trimmed === "") return null;

  // delta-seconds
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  // A date already in the past means "retry now", not "travel backwards".
  return Math.max(0, parsed - nowMs);
}

function isClientErrorMessage(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^HTTP 4\d{2}/.test(error.message) &&
    !/^HTTP 429/.test(error.message)
  );
}

/**
 * Fetch with retry. Returns the response on success; throws on exhausted
 * retries, on a non-429 4xx, or `RetryDeadlineExceededError` when the
 * required wait would outlive the run.
 */
export async function fetchWithRetry({
  url,
  method = "GET",
  headers,
  body,
  signal,
  deadlineAtMs,
  sleep = defaultSleep,
  now = Date.now,
}: FetchWithRetryOptions): Promise<FetchResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    let waitMs: number | null = null;

    try {
      // Two independent bounds: this request's own timeout, and the run's
      // deadline. Either one firing must unwind the call.
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

      const response = await ssrfSafeFetch(url, {
        method,
        headers,
        body,
        signal: requestSignal,
      });

      if (response.status === 429) {
        const retryAfter = parseRetryAfterMs(
          response.headers.get("retry-after"),
          now(),
        );
        // Cap a server-supplied wait: an hour-long Retry-After is a "come
        // back next run" instruction, and the deadline check below turns it
        // into exactly that.
        waitMs =
          retryAfter == null
            ? null
            : Math.min(retryAfter, MAX_RETRY_AFTER_MS);
        lastError = new Error(`HTTP 429 ${response.statusText} (${url})`);
      } else if (response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      } else if (response.status >= 400) {
        // Every other 4xx fails fast — retrying a 401 or a 400 just repeats it.
        throw new Error(
          `HTTP ${response.status} ${response.statusText} (${url})`,
        );
      } else {
        return response;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isClientErrorMessage(error)) throw error;
    }

    // Retrying past the run's deadline just burns time the scheduler has
    // already given up waiting for.
    if (signal?.aborted) break;

    const backoff = RETRY_DELAYS_MS[attempt];
    if (backoff === undefined || attempt >= RETRY_DELAYS_MS.length) break;

    const delay = waitMs ?? backoff;

    if (deadlineAtMs !== undefined && now() + delay > deadlineAtMs) {
      // Not a failure. The caller persists its cursor and the next run picks
      // up where this one stopped.
      throw new RetryDeadlineExceededError(delay);
    }

    await sleep(delay);
  }

  throw lastError ?? new Error("fetchWithRetry: unknown error");
}
