/**
 * Whether a failed read is worth trying again, for the one QueryClient a
 * browser composition builds.
 *
 * React Query's default replays every failure three times, which turns a
 * refusal the customer could act on into three seconds of spinner and then the
 * same refusal. The rule here reads the failure instead: a permanent one is
 * shown at once, a transient one is replayed within a budget.
 */

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

/**
 * Statuses where an automatic replay cannot change the answer: the request was
 * malformed, unauthorized, or aimed at something that is not there.
 *
 * 409 is deliberately absent. A conflict is the one 4xx that regularly IS
 * transient — a resource written concurrently, a provider record that settles
 * a second later, a link a webhook has not delivered yet. Permanent conflicts
 * are excluded by their code above, because that is where the distinction
 * actually lives.
 */
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

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (isPermanentFailure(error)) return false;

  const httpStatus = (error as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus;

  return !(typeof httpStatus === "number" && HTTP_STATUS_TO_NOT_RETRY.includes(httpStatus));
}
