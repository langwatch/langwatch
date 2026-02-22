/**
 * Custom error types for billing domain.
 * Framework-agnostic — mapped to tRPC/HTTP errors by the router middleware.
 *
 * All billing errors extend BillingError which carries a trpcCode.
 * The middleware uses a single instanceof check, so adding new errors
 * never requires updating middleware.ts.
 */

type BillingErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "INTERNAL_SERVER_ERROR";

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly trpcCode: BillingErrorCode,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export class OrganizationNotFoundError extends BillingError {
  constructor() {
    super("Organization not found", "NOT_FOUND");
    this.name = "OrganizationNotFoundError";
  }
}

export class UserEmailRequiredError extends BillingError {
  constructor() {
    super("User email is required to create Stripe customer", "UNAUTHORIZED");
    this.name = "UserEmailRequiredError";
  }
}

export class CustomerCreationRaceError extends BillingError {
  constructor() {
    super(
      "Stripe customer ID missing after concurrent creation",
      "INTERNAL_SERVER_ERROR",
    );
    this.name = "CustomerCreationRaceError";
  }
}

export class InvalidPlanError extends BillingError {
  constructor(plan: string) {
    super(`Plan ${plan} does not have an associated Stripe price`, "BAD_REQUEST");
    this.name = "InvalidPlanError";
  }
}

export class SeatBillingUnavailableError extends BillingError {
  constructor() {
    super("Seat event billing is not available", "INTERNAL_SERVER_ERROR");
    this.name = "SeatBillingUnavailableError";
  }
}

export class NoActiveSubscriptionError extends BillingError {
  constructor() {
    super("No active subscription found", "NOT_FOUND");
    this.name = "NoActiveSubscriptionError";
  }
}

export class SubscriptionItemNotFoundError extends BillingError {
  constructor(item: string) {
    super(`No ${item} item found on subscription`, "INTERNAL_SERVER_ERROR");
    this.name = "SubscriptionItemNotFoundError";
  }
}

export class SubscriptionRecordNotFoundError extends BillingError {
  constructor(identifier: string) {
    super(
      `No subscription record found for ${identifier}`,
      "INTERNAL_SERVER_ERROR",
    );
    this.name = "SubscriptionRecordNotFoundError";
  }
}
