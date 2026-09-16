/**
 * Transient-failure classification must match the outer queue's classifier —
 * disagreement lets a permanent failure burn its 25-attempt retry budget.
 * Backoff takes an injectable `random` only so a test can pin the jitter.
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
export const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

export interface TransientClassificationInput {
  error: unknown;
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
 * Anchored to the WHOLE message: matching `/timeout/i` anywhere let a query
 * merely naming a `timeout` column or setting read as transient, burning the
 * retry budget on a permanent failure that could never succeed.
 */
const DRIVER_TIMEOUT_MESSAGE = /^timeout error\.?$/i;

function isDriverTimeout(error: Error): boolean {
  return error.name === "TimeoutError" || DRIVER_TIMEOUT_MESSAGE.test(error.message.trim());
}

/**
 * Whether a failure is worth another attempt. Deliberately conservative:
 * anything unrecognised is permanent, since retrying costs the full budget
 * and can worsen a server overload the retries themselves caused.
 */
export function isTransientClickHouseError({
  error,
  transientMessageFragments = [],
}: TransientClassificationInput): boolean {
  if (!(error instanceof Error)) return false;

  if (isDriverTimeout(error)) return true;

  for (const fragment of transientMessageFragments) {
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
 * The level a retry notice is emitted at. Only the first attempt warrants a
 * warn — a slow endpoint's 25-attempt budget once turned one failure into
 * 25 records that each read as a separate failure.
 */
export function retryNoticeLevel(attempt: number): "warn" | "debug" {
  return attempt === 0 ? "warn" : "debug";
}

/** Where a retry notice attaches its cause. Never `error`; see ./logging.ts. */
export const RETRY_CAUSE_FIELD = "retryError";

/**
 * Where a failed-attempt notice attaches its cause. Never `error`; see
 * ./logging.ts. Separate from {@link RETRY_CAUSE_FIELD}: a retry notice says
 * an attempt failed and another is coming, this says it was raised to the caller.
 */
export const QUERY_CAUSE_FIELD = "queryError";
