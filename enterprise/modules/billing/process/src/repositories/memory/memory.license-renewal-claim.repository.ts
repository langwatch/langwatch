// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import {
  LicenseRenewalClaimRepository,
  type LicenseRenewalClaimOutcome,
} from "../license-renewal-claim.repository.ts";

type ClaimRow = {
  stripeSubscriptionId: string;
  claimedAt: Instant;
  deliveredAt: Instant | null;
  licenseId: string | null;
};

/** The renewal claim's twin: one row per invoice id, as the primary key keeps it. */
export class MemoryLicenseRenewalClaimRepository extends LicenseRenewalClaimRepository {
  readonly rows = new Map<string, ClaimRow>();

  private constructor() {
    super();
  }

  static create(): MemoryLicenseRenewalClaimRepository {
    return new MemoryLicenseRenewalClaimRepository();
  }

  async claim({
    stripeInvoiceId,
    stripeSubscriptionId,
    now,
    leaseMs,
  }: {
    stripeInvoiceId: string;
    stripeSubscriptionId: string;
    now: Instant;
    leaseMs: number;
  }): Promise<LicenseRenewalClaimOutcome> {
    const existing = this.rows.get(stripeInvoiceId);
    if (existing?.deliveredAt) return "delivered";
    if (existing && existing.claimedAt.epochMilliseconds > now.epochMilliseconds - leaseMs)
      return "in_flight";
    this.rows.set(stripeInvoiceId, {
      stripeSubscriptionId,
      claimedAt: now,
      deliveredAt: null,
      licenseId: null,
    });
    return "claimed";
  }

  async markDelivered({
    stripeInvoiceId,
    licenseId,
    deliveredAt,
  }: {
    stripeInvoiceId: string;
    licenseId: string;
    deliveredAt: Instant;
  }): Promise<void> {
    const row = this.rows.get(stripeInvoiceId);
    if (row) this.rows.set(stripeInvoiceId, { ...row, deliveredAt, licenseId });
  }

  async release({ stripeInvoiceId }: { stripeInvoiceId: string }): Promise<void> {
    if (!this.rows.get(stripeInvoiceId)?.deliveredAt) this.rows.delete(stripeInvoiceId);
  }
}
