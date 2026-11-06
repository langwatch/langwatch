// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** What claiming a paid renewal invoice found. */
export type LicenseRenewalClaimOutcome =
  /** This caller holds the invoice and mints its licence. */
  | "claimed"
  /** The invoice's licence went out already: a redelivery mints nothing. */
  | "delivered"
  /** Another delivery holds a live claim on the invoice. */
  | "in_flight";

/**
 * One renewed licence per paid Stripe invoice. A claim is a lease: one never
 * delivered can be taken over once `claimedAt` is older than `leaseMs`, and
 * a failed delivery releases it so Stripe's retry mints again.
 */
export abstract class LicenseRenewalClaimRepository {
  abstract claim(input: {
    stripeInvoiceId: string;
    stripeSubscriptionId: string;
    now: Instant;
    leaseMs: number;
  }): Promise<LicenseRenewalClaimOutcome>;

  abstract markDelivered(input: {
    stripeInvoiceId: string;
    licenseId: string;
    deliveredAt: Instant;
  }): Promise<void>;

  /** Drops an undelivered claim; a delivered one stays. */
  abstract release(input: { stripeInvoiceId: string }): Promise<void>;
}
