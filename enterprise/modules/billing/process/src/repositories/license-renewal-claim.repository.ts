// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** The signed licence of a renewal, kept between minting and mailing. */
export type IssuedRenewalLicense = {
  licenseKey: string;
  licenseData: {
    licenseId: string;
    plan: { type: string };
    expiresAt: string;
    organizationName: string;
  };
};

/** What claiming a paid renewal invoice found. */
export type LicenseRenewalClaimOutcome =
  /** This caller holds the invoice; `issued` is the licence an earlier holder minted but never mailed. */
  | { outcome: "claimed"; token: string; issued: IssuedRenewalLicense | null }
  /** The invoice's licence went out already: a redelivery mints nothing. */
  | { outcome: "delivered" }
  /** Another delivery holds a live claim on the invoice. */
  | { outcome: "in_flight" };

/**
 * One renewed licence per paid Stripe invoice. A claim is a lease fenced by
 * its token: a stale holder can neither complete nor release a claim taken
 * over after `leaseMs`. A minted licence stays on the claim until it is
 * mailed, so a retry mails it again instead of minting another.
 */
export abstract class LicenseRenewalClaimRepository {
  abstract claim(input: {
    stripeInvoiceId: string;
    stripeSubscriptionId: string;
    now: Instant;
    leaseMs: number;
  }): Promise<LicenseRenewalClaimOutcome>;

  /** False when the claim was taken over: the caller no longer holds it. */
  abstract recordIssued(input: {
    stripeInvoiceId: string;
    token: string;
    issued: IssuedRenewalLicense;
  }): Promise<boolean>;

  /** False when the claim was taken over. Clears the kept licence. */
  abstract markDelivered(input: {
    stripeInvoiceId: string;
    token: string;
    licenseId: string;
    deliveredAt: Instant;
  }): Promise<boolean>;

  /** Frees an undelivered claim held by `token`; a minted licence stays for the retry. */
  abstract release(input: { stripeInvoiceId: string; token: string }): Promise<void>;
}
