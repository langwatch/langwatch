/**
 * Handled errors for the billing domain.
 *
 * Every class here is a `HandledError` with a stable `code`, so it travels the
 * handled channel untouched: the tRPC boundary maps `httpStatus` to a tRPC
 * code and puts the *code* on the wire, and the client renders copy from
 * `src/features/errors/logic/presentation.ts` keyed by that code. There is no
 * billing-specific middleware any more — the previous `BillingError` carried a
 * `trpcCode` string that `middleware.ts` re-threw as a bare `TRPCError` with no
 * `cause`, which collapsed all five `INTERNAL_SERVER_ERROR` variants into "An
 * unknown error occurred" for causes we can name.
 *
 * Two rules this file exists to hold:
 *
 * - **Every 5xx sets `fault` explicitly.** It defaults to `"customer"`, so an
 *   unannotated 5xx logs a real incident as routine noise.
 * - **`message` is customer-safe.** The REST boundary ships it in the response
 *   body, so it never names Stripe, a price catalog, an env var or a service.
 *   Internal detail belongs in `meta` (only where a client reads it) and in the
 *   log line at the throw site.
 */

import { HandledError } from "@langwatch/handled-error";

/**
 * The organization behind a billing action does not exist (or is not visible).
 *
 * Known and actionable: reload and pick an organization that is still there.
 */
export class OrganizationNotFoundError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "OrganizationNotFoundError";
  }
}

/**
 * Billing needs an email address on the account and there isn't one.
 *
 * The old message named the billing provider and the record it was trying to
 * create ("...to create Stripe customer"), which told a customer about our
 * plumbing and nothing about what to do. It also answered 401, which reads as
 * "sign in again" — the wrong instruction for an account that is missing a
 * field. 422 keeps it on the validation path, where it belongs.
 */
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

/**
 * The plan the customer picked has no price configured on our side.
 *
 * `fault: "platform"` and a 5xx, not the 400 this used to be: the customer's
 * request was fine, our catalog is incomplete. The old message
 * ("Plan X does not have an associated Stripe price") described our
 * misconfiguration to the person least able to fix it. The plan name is the
 * customer's own selection, so it stays in `meta`; the catalog detail belongs
 * in the log line at the throw site.
 */
export class InvalidPlanError extends HandledError {
  declare readonly code: "billing_plan_price_missing";

  constructor(plan: string) {
    super(
      "billing_plan_price_missing",
      "This plan is not available for purchase yet",
      { httpStatus: 500, fault: "platform", meta: { plan } },
    );
    this.name = "InvalidPlanError";
  }
}

/**
 * Seat-based billing is not wired up in this deployment, so a seat action
 * cannot be completed.
 *
 * `fault: "platform"` rather than `"provider"`: nothing third-party was asked
 * anything — the seat-event collaborator simply isn't configured here, which is
 * ours. (The customer-facing copy is keyed off the `code`, not the fault, so
 * this only decides log level and alerting.)
 */
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

/**
 * We hold no active subscription for this organization where one was expected.
 *
 * Reached from proration preview and seat updates, both of which are only
 * offered when our records say a subscription exists — so arriving here means
 * our copy and the billing provider's have drifted apart.
 */
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

/**
 * A live subscription exists in our records but was never linked to its
 * counterpart at the billing provider, so seat changes cannot be made from
 * the app at all.
 *
 * Deliberately NOT `subscription_sync_failed`: that code's copy promises the
 * state "usually catches up on its own", and this one never does — linking the
 * record is an operator action. A subscription lands here when it was set up
 * by hand at the provider rather than through our checkout, which is the only
 * flow that writes the link.
 */
export class SubscriptionNotLinkedError extends HandledError {
  declare readonly code: "subscription_not_linked";

  constructor() {
    super(
      "subscription_not_linked",
      "This subscription isn't connected to billing yet",
      { httpStatus: 409, fault: "platform" },
    );
    this.name = "SubscriptionNotLinkedError";
  }
}

/**
 * The organization carries more than one live subscription, so there is no
 * single record a seat change can be charged against.
 *
 * Nothing in the checkout or webhook path produces this — both only ever turn
 * ACTIVE a row resolved by its provider id. It comes from the backoffice
 * subscription form, which writes any status against any organization with no
 * uniqueness check and no constraint behind it (there is no unique index on
 * `organizationId`).
 *
 * We refuse rather than pick. Preferring the linked row charges whichever
 * subscription happens to still carry a provider id, which on a money path is
 * a guess wearing a rule: the operator who added the second row may well have
 * meant it to supersede the first. Guessing here bills the wrong plan
 * silently; refusing costs a support message and nothing else.
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
 * The customer confirmed a seat change against a quote that is too old to
 * charge.
 *
 * The billing provider prices a mid-term change by the moment it is applied,
 * so a quote and a confirmation made at different times are different amounts.
 * We pin the confirmation to the instant the quote was issued; past a short
 * window that pin is refused rather than honoured, because the further it
 * drifts the more it charges for time the customer already paid for — and past
 * a period boundary it is a different bill entirely.
 *
 * `customer` fault: nothing failed, the dialog simply sat open. Reopening it
 * produces a fresh quote.
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

/**
 * The subscription exists but is missing the line item we needed to change.
 *
 * Same drift as {@link NoActiveSubscriptionError}, one level further in. The
 * item name is ours, not the customer's, so it stays out of the message.
 */
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

/**
 * A seat count that cannot be billed reached the line-item builder.
 *
 * Stays a 422 `validation_error` because the number genuinely is invalid and
 * the shape the client reads for it (`meta.fieldErrors`) puts the complaint on
 * the seat input rather than in a toast.
 */
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

/**
 * We could not write the pending subscription record that the checkout hangs
 * off, so the checkout was never started.
 */
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

/**
 * A billing event arrived for a subscription we hold no record of.
 *
 * Webhook-side rather than customer-side, but still a named cause with a
 * trace id worth carrying, so it goes on the handled channel too. The
 * identifier is ours; it goes in `meta` for the log/agent readers, never in
 * the sentence.
 */
export class SubscriptionRecordNotFoundError extends HandledError {
  declare readonly code: "subscription_sync_failed";

  constructor(identifier: string) {
    super(
      "subscription_sync_failed",
      "No subscription record matches this billing event",
      { httpStatus: 500, fault: "platform", meta: { identifier } },
    );
    this.name = "SubscriptionRecordNotFoundError";
  }
}

/**
 * The billing provider rejected our usage-summary request outright — an
 * invalid request or an authentication failure, both of which are our
 * configuration rather than a blip.
 *
 * A timeout or a provider 5xx is deliberately NOT this: those stay plain
 * `Error`s so they degrade to "unknown" with a trace id and stay retryable.
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
 * The account is billed in a currency we sell no prices in.
 *
 * A billing account is locked to one currency once it has been invoiced, and
 * every later checkout has to match it. If that currency isn't one we price
 * plans in, no self-serve upgrade can succeed — so this stops before anything
 * is written rather than letting the payment provider reject the session and
 * leave a half-made subscription behind.
 *
 * `fault: "customer"` only in the sense that it is account state, not an
 * outage: it is not something the customer can correct from the UI, which is
 * why the copy sends them to support instead of telling them to retry.
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
 * The billing profile this organization points at no longer exists.
 *
 * Deletion is terminal on the provider's side: the record still reads back,
 * but nothing can be attached to it, so no currency or plan makes the checkout
 * succeed. Retrying cannot help and neither can the customer — putting the
 * organization back on a usable billing profile is an explicit, audited
 * operation, not something to paper over by quietly making a new one here.
 */
export class BillingCustomerDeletedError extends HandledError {
  declare readonly code: "billing_customer_deleted";

  constructor() {
    super(
      "billing_customer_deleted",
      "This account's billing profile is no longer active",
      { httpStatus: 409, fault: "platform" },
    );
    this.name = "BillingCustomerDeletedError";
  }
}

/**
 * The payment provider told us to wait, or we could not reach it.
 *
 * Deliberately narrow: raised only for the two shapes that mean "nothing
 * happened, try again" — rate limiting and connection failure. Every other
 * provider failure stays unhandled and degrades to unknown at the boundary,
 * because naming a cause we do not understand would promise the caller an
 * action they do not have. The classification lives in `translateStripeError`.
 */
export class BillingProviderUnavailableError extends HandledError {
  declare readonly code: "billing_provider_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "billing_provider_unavailable",
      "The payment provider could not be reached",
      { httpStatus: 503, fault: "provider", ...options },
    );
    this.name = "BillingProviderUnavailableError";
  }
}
