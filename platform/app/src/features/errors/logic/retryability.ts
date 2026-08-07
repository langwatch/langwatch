import type { AppErrorCode } from "./codes";
import { readHandledError } from "./readHandledError";

/**
 * Handled failures where trying again cannot change the answer.
 *
 * Keyed on the error's `code`, deliberately not on its HTTP status. Status is
 * too coarse to carry this: `subscription_not_linked` and
 * `subscription_sync_failed` are both 409s from the same procedure, and they
 * are opposites — one needs an operator, the other is drift that resolves
 * itself, which is exactly what its registry copy tells the customer ("this
 * usually catches up on its own"). A status-keyed rule has to be wrong about
 * one of them.
 *
 * Membership is justified per entry by the entry's own copy in
 * `presentation.ts`: every code here sends the customer to support or tells
 * them the thing is managed elsewhere. None of them says "try again".
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
 * True when the failure is one a replay cannot fix, so the caller should show
 * it rather than retrying behind a spinner.
 *
 * An unhandled error is never permanent as far as this is concerned: we could
 * not name its cause, so we cannot claim to know that it will happen again.
 */
export function isPermanentFailure(error: unknown): boolean {
  const handled = readHandledError(error);
  if (!handled) return false;

  return PERMANENT_ERROR_CODES.has(handled.code as AppErrorCode);
}
