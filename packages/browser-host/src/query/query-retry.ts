import type { AppErrorCode } from "@langwatch/handled-error/app-codes";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

export const MAX_QUERY_RETRIES = 4;

/** Handled failures where trying again cannot change the answer. */
const PERMANENT_ERROR_CODES = new Set<AppErrorCode>([
  // "Contact support and we'll finish the setup." Only an operator can link
  // the subscription.
  "subscription_not_linked",
  // "Contact support and we'll get you onto the right plan." The account is
  // locked to a currency we do not sell in.
  "billing_currency_unsupported",
  // "Contact support to get set back up." The billing profile was deleted at
  // the provider; recovery is an audited operation.
  "billing_customer_deleted",
  // "Plans are managed outside the app." There is no billing provider in a
  // self-hosted deployment.
  "subscription_service_unavailable",
  // "Contact support and we'll sort it out." Two live plans on one account;
  // only an operator can decide which one survives.
  "subscription_ambiguous",
  // "Close this and open it again." A replay sends the same stale quote and
  // gets the same refusal — the fix is a new quote, not another attempt.
  "billing_quote_expired",
]);

/** 409 is deliberately absent because conflicts can be transient. */
const HTTP_STATUS_TO_NOT_RETRY: readonly number[] = [400, 401, 403, 404, 422, 431];

/**
 * True when the failure is one a replay cannot fix, so the caller shows it
 * rather than retrying behind a spinner.
 */
export function isPermanentFailure(error: unknown): boolean {
  const handled = readHandledError(error);
  if (!handled) return false;

  return PERMANENT_ERROR_CODES.has(handled.code as AppErrorCode);
}

/**
 * The api answers this while the worker upgrades the schema (NO-HOLDS): it clears on its own, so
 * a read keeps trying past the cap, on the client's exponential backoff (capped at 30 s).
 */
function isUpgradeInProgress(error: unknown): boolean {
  return readHandledError(error)?.code === "upgrade_in_progress";
}

/** The personal workspace is still being created: the read waits, never fails. */
function isPersonalWorkspacePending(error: unknown): boolean {
  return readHandledError(error)?.code === "personal_workspace_pending";
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isUpgradeInProgress(error) || isPersonalWorkspacePending(error)) return true;
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (isPermanentFailure(error)) return false;

  const httpStatus = httpStatusOf(error);

  return !(typeof httpStatus === "number" && HTTP_STATUS_TO_NOT_RETRY.includes(httpStatus));
}

const THROTTLE_BACKOFF_BASE_MS = 5_000;
const THROTTLE_BACKOFF_CAP_MS = 60_000;

function httpStatusOf(error: unknown): unknown {
  return (error as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus;
}

function hintedDelayMs({
  afterMs,
  afterSeconds,
}: {
  afterMs: number;
  afterSeconds: number;
}): number {
  if (afterMs > 0) return afterMs;
  if (afterSeconds > 0) return afterSeconds * 1000;
  return 0;
}

/**
 * Wait before retry number `failureCount`. A 429 honours the server's `retryAfterMs` or
 * `retryAfterSeconds`, else backs off 5 s, 10 s, 20 s, 40 s; both capped at 60 s. Anything
 * else keeps react-query's default (1 s doubling, capped at 30 s).
 */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (isPersonalWorkspacePending(error)) return 2_000;
  if (httpStatusOf(error) !== 429) return Math.min(1000 * 2 ** failureCount, 30_000);

  const meta = readHandledError(error)?.meta;
  const afterMs = Number(meta?.retryAfterMs);
  const afterSeconds = Number(meta?.retryAfterSeconds);
  const hinted = hintedDelayMs({ afterMs, afterSeconds });
  const delay = hinted || THROTTLE_BACKOFF_BASE_MS * 2 ** failureCount;

  return Math.min(delay, THROTTLE_BACKOFF_CAP_MS);
}
