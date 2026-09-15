/**
 * Each class is a HandledError with stable code. Every 5xx sets fault
 * explicitly; message is always customer-safe.
 */

import { HandledError } from "@langwatch/handled-error";
export { OrganizationNotFoundError } from "@langwatch/organization-contract";

/** Billing requires an email; 422 validates the account field, not auth. */
export class UserEmailRequiredError extends HandledError {
  declare readonly code: "billing_customer_email_required";

  constructor() {
    super(
      "billing_customer_email_required",
      "Billing needs an email address on this account before it can continue",
      { httpStatus: 422, fault: "customer" },
    );
    this.name = "UserEmailRequiredError";
  }
}

/**
 * Two requests created the billing customer at once and our re-read still
 * didn't see the id.
 *
 * Ours to get right, and it does resolve itself — which is exactly what the
 * `subscription_sync_failed` copy says ("this usually catches up on its own;
 * reload in a few minutes").
 */
export class CustomerCreationRaceError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor() {
    super(
      "subscription_sync_failed",
      "Billing details are still being set up for this organization",
      { httpStatus: 500, fault: "platform" },
    );
    this.name = "CustomerCreationRaceError";
  }
}

/** Plan has no configured price on our side; 5xx because our catalog is incomplete. */
export class InvalidPlanError extends HandledError {
  declare readonly code: "billing_plan_price_missing";

  constructor(plan: string) {
    super("billing_plan_price_missing", "This plan is not available for purchase yet", {
      httpStatus: 500,
      fault: "platform",
      meta: { plan },
    });
    this.name = "InvalidPlanError";
  }
}

/** Seat billing not configured; platform fault, not provider. */
export class SeatBillingUnavailableError extends HandledError {
  declare readonly code: "seat_billing_unavailable";

  constructor() {
    super("seat_billing_unavailable", "Seat billing is not available", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "SeatBillingUnavailableError";
  }
}

/** No active subscription when one was expected; drift with the provider. */
export class NoActiveSubscriptionError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor() {
    super("subscription_sync_failed", "No active subscription found", {
      httpStatus: 409,
      fault: "platform",
    });
    this.name = "NoActiveSubscriptionError";
  }
}

/** Subscription unlinked from provider; never catches up on its own. */
export class SubscriptionNotLinkedError extends HandledError {
  declare readonly code: "subscription_not_linked";

  constructor() {
    super("subscription_not_linked", "This subscription isn't connected to billing yet", {
      httpStatus: 409,
      fault: "platform",
    });
    this.name = "SubscriptionNotLinkedError";
  }
}

/**
 * Multiple subscriptions exist; refusing to guess which to change avoids
 * silently billing the wrong plan.
 */
export class AmbiguousSubscriptionError extends HandledError {
  declare readonly code: "subscription_ambiguous";

  constructor(count: number) {
    super(
      "subscription_ambiguous",
      "This account has more than one active plan, so we can't tell which one to change",
      { httpStatus: 409, fault: "platform", meta: { count } },
    );
    this.name = "AmbiguousSubscriptionError";
  }
}

/**
 * Quote confirmation aged past the acceptable window; past a period boundary
 * it becomes a different bill. Reopening produces a fresh quote.
 */
export class QuoteExpiredError extends HandledError {
  declare readonly code: "billing_quote_expired";

  constructor() {
    super(
      "billing_quote_expired",
      "This quote is out of date — reopen it to see the current amount",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "QuoteExpiredError";
  }
}

/** Missing subscription line item; drift with the provider one level in. */
export class SubscriptionItemNotFoundError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor(item: string) {
    super(
      "subscription_sync_failed",
      "This subscription is missing a line item we needed to update",
      { httpStatus: 500, fault: "platform", meta: { item } },
    );
    this.name = "SubscriptionItemNotFoundError";
  }
}

/** Unbillable seat count; 422 puts validation on the seat input. */
export class InvalidSeatCountError extends HandledError {
  declare readonly code: "validation_error";

  constructor(count: number) {
    super("validation_error", "Seat count must be at least 1", {
      httpStatus: 422,
      fault: "customer",
      meta: {
        fieldErrors: { totalSeats: ["Enter a seat count of 1 or more."] },
        receivedSeatCount: count,
      },
    });
    this.name = "InvalidSeatCountError";
  }
}

/** Failed to create the pending subscription record; checkout never started. */
export class SubscriptionCreationFailedError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor() {
    super(
      "subscription_sync_failed",
      "The subscription could not be started; nothing was charged",
      { httpStatus: 500, fault: "platform" },
    );
    this.name = "SubscriptionCreationFailedError";
  }
}

/** Billing event for unknown subscription; webhook-side drift. */
export class SubscriptionRecordNotFoundError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor(identifier: string) {
    super("subscription_sync_failed", "No subscription record matches this billing event", {
      httpStatus: 500,
      fault: "platform",
      meta: { identifier },
    });
    this.name = "SubscriptionRecordNotFoundError";
  }
}

/**
 * Provider rejected the request; our config error, not a blip or timeout.
 */
export class UsageReportFailedError extends HandledError {
  declare readonly code: "usage_report_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("usage_report_failed", "The usage report could not be built", {
      httpStatus: 500,
      fault: "platform",
      ...options,
    });
    this.name = "UsageReportFailedError";
  }
}

/**
 * Account locked to a currency we don't price plans in; stop before writing
 * half a subscription.
 */
export class UnsupportedBillingCurrencyError extends HandledError {
  declare readonly code: "billing_currency_unsupported";

  constructor() {
    super(
      "billing_currency_unsupported",
      "This account is billed in a currency this plan isn't sold in",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "UnsupportedBillingCurrencyError";
  }
}

/**
 * Billing profile deleted on provider; terminal state requiring explicit
 * operator action to restore.
 */
export class BillingCustomerDeletedError extends HandledError {
  declare readonly code: "billing_customer_deleted";

  constructor() {
    super("billing_customer_deleted", "This account's billing profile is no longer active", {
      httpStatus: 409,
      fault: "platform",
    });
    this.name = "BillingCustomerDeletedError";
  }
}

/**
 * Provider rate-limited or unreachable; only for retryable shapes, not
 * configuration errors.
 */
export class BillingProviderUnavailableError extends HandledError {
  declare readonly code: "billing_provider_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("billing_provider_unavailable", "The payment provider could not be reached", {
      httpStatus: 503,
      fault: "provider",
      ...options,
    });
    this.name = "BillingProviderUnavailableError";
  }
}
