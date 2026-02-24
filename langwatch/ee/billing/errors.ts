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
  public readonly trpcCode: BillingErrorCode;

  constructor({
    message,
    trpcCode,
  }: {
    message: string;
    trpcCode: BillingErrorCode;
  }) {
    super(message);
    this.trpcCode = trpcCode;
    this.name = "BillingError";
  }
}

export class OrganizationNotFoundError extends BillingError {
  constructor() {
    super({ message: "Organization not found", trpcCode: "NOT_FOUND" });
    this.name = "OrganizationNotFoundError";
  }
}

export class UserEmailRequiredError extends BillingError {
  constructor() {
    super({
      message: "User email is required to create Stripe customer",
      trpcCode: "UNAUTHORIZED",
    });
    this.name = "UserEmailRequiredError";
  }
}

export class CustomerCreationRaceError extends BillingError {
  constructor() {
    super({
      message: "Stripe customer ID missing after concurrent creation",
      trpcCode: "INTERNAL_SERVER_ERROR",
    });
    this.name = "CustomerCreationRaceError";
  }
}

export class InvalidPlanError extends BillingError {
  constructor(plan: string) {
    super({
      message: `Plan ${plan} does not have an associated Stripe price`,
      trpcCode: "BAD_REQUEST",
    });
    this.name = "InvalidPlanError";
  }
}

export class SeatBillingUnavailableError extends BillingError {
  constructor() {
    super({
      message: "Seat event billing is not available",
      trpcCode: "INTERNAL_SERVER_ERROR",
    });
    this.name = "SeatBillingUnavailableError";
  }
}

export class NoActiveSubscriptionError extends BillingError {
  constructor() {
    super({ message: "No active subscription found", trpcCode: "NOT_FOUND" });
    this.name = "NoActiveSubscriptionError";
  }
}

export class SubscriptionItemNotFoundError extends BillingError {
  constructor(item: string) {
    super({
      message: `No ${item} item found on subscription`,
      trpcCode: "INTERNAL_SERVER_ERROR",
    });
    this.name = "SubscriptionItemNotFoundError";
  }
}

export class InvalidSeatCountError extends BillingError {
  constructor(count: number) {
    super({
      message: `coreMembers must be at least 1, got ${count}`,
      trpcCode: "BAD_REQUEST",
    });
    this.name = "InvalidSeatCountError";
  }
}

export class SubscriptionRecordNotFoundError extends BillingError {
  constructor(identifier: string) {
    super({
      message: `No subscription record found for ${identifier}`,
      trpcCode: "INTERNAL_SERVER_ERROR",
    });
    this.name = "SubscriptionRecordNotFoundError";
  }
}
