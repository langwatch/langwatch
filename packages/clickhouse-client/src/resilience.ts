/**
 * Transient-failure classification and backoff.
 *
 * Two things live here that were previously decided inline at the retry site.
 *
 * Classification is a policy, not a detail: whether a failure is worth
 * retrying has to match the outer queue's classifier, or the two layers
 * disagree and a permanent failure burns a 25-attempt budget. The caller
 * supplies the shared message fragments rather than this package owning a
 * second copy of the list.
 *
 * Backoff takes an injectable `random` so a test can pin the jitter. That is
 * the only reason it is a parameter.
 */

/** Socket-level codes worth another attempt. */
export const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

/** Statuses the server uses for "busy, come back". */
export const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503,
]);

export interface TransientClassificationOptions {
  /**
   * Message fragments that mark a ClickHouse-side transient condition, owned by
   * the caller so this package cannot drift from the queue's classifier.
   */
  transientMessageFragments?: readonly string[];
}

function statusOf(error: object): number | undefined {
  const withStatus = error as { statusCode?: number; status?: number };
  return withStatus.statusCode ?? withStatus.status;
}

/**
 * Whether a failure is worth another attempt.
 *
 * Deliberately conservative: anything unrecognised is permanent. Retrying a
 * permanent failure costs the full budget and, when the failure is a server
 * overload the retries themselves caused, makes the overload worse.
 */
export function isTransientClickHouseError(
  error: unknown,
  options: TransientClassificationOptions = {},
): boolean {
  if (!(error instanceof Error)) return false;

  if (/timeout/i.test(error.message)) return true;

  for (const fragment of options.transientMessageFragments ?? []) {
    if (error.message.includes(fragment)) return true;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }

  const status = statusOf(error);
  return status !== undefined && TRANSIENT_HTTP_STATUSES.has(status);
}

export interface BackoffInput {
  /** Zero-based. */
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injectable for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

/** Exponential with full-base jitter, clamped to `maxDelayMs`. */
export function jitteredBackoffMs({
  attempt,
  baseDelayMs,
  maxDelayMs,
  random = Math.random,
}: BackoffInput): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * The level a retry notice should be emitted at.
 *
 * Only the first attempt is worth a warn. A slow endpoint produces one notice
 * per retry, so a 25-attempt budget turned a single failure into 25 records
 * that each read as a separate failure.
 */
export function retryNoticeLevel(attempt: number): "warn" | "debug" {
  return attempt === 0 ? "warn" : "debug";
}

/** Where a retry notice attaches its cause. Never `error`; see ./logging.ts. */
export const RETRY_CAUSE_FIELD = "retryError";
