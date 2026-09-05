import type { AppErrorCode } from "@langwatch/handled-error/app-codes";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

/**
 * Handled failures where trying again cannot change the answer.
 */
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
 * True when the failure is one a replay cannot fix, so the caller should show it rather
 * than retrying behind a spinner.
 */
export function isPermanentFailure(error: unknown): boolean {
  const handled = readHandledError(error);
  if (!handled) return false;

  return PERMANENT_ERROR_CODES.has(handled.code as AppErrorCode);
}
