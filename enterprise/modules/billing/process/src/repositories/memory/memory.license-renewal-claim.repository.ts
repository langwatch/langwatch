// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Temporal, type Instant } from "@langwatch/time";

import {
  LicenseRenewalClaimRepository,
  type IssuedRenewalLicense,
  type LicenseRenewalClaimOutcome,
} from "../license-renewal-claim.repository.ts";

/** A released claim with a minted licence keeps its row; this lease is long over. */
const RELEASED_AT = Temporal.Instant.fromEpochMilliseconds(0);

type ClaimRow = {
  stripeSubscriptionId: string;
  claimToken: string;
  claimedAt: Instant;
  issuedLicense: IssuedRenewalLicense | null;
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
    if (existing?.deliveredAt) return { outcome: "delivered" };
    if (existing && existing.claimedAt.epochMilliseconds > now.epochMilliseconds - leaseMs)
      return { outcome: "in_flight" };
    const token = generate("billing").toString();
    this.rows.set(stripeInvoiceId, {
      stripeSubscriptionId,
      claimToken: token,
      claimedAt: now,
      issuedLicense: existing?.issuedLicense ?? null,
      deliveredAt: null,
      licenseId: existing?.licenseId ?? null,
    });
    return { outcome: "claimed", token, issued: existing?.issuedLicense ?? null };
  }

  async recordIssued({
    stripeInvoiceId,
    token,
    issued,
  }: {
    stripeInvoiceId: string;
    token: string;
    issued: IssuedRenewalLicense;
  }): Promise<boolean> {
    const row = this.heldRow({ stripeInvoiceId, token });
    if (!row) return false;
    this.rows.set(stripeInvoiceId, {
      ...row,
      issuedLicense: issued,
      licenseId: issued.licenseData.licenseId,
    });
    return true;
  }

  async markDelivered({
    stripeInvoiceId,
    token,
    licenseId,
    deliveredAt,
  }: {
    stripeInvoiceId: string;
    token: string;
    licenseId: string;
    deliveredAt: Instant;
  }): Promise<boolean> {
    const row = this.heldRow({ stripeInvoiceId, token });
    if (!row) return false;
    this.rows.set(stripeInvoiceId, { ...row, deliveredAt, licenseId, issuedLicense: null });
    return true;
  }

  async release({
    stripeInvoiceId,
    token,
  }: {
    stripeInvoiceId: string;
    token: string;
  }): Promise<void> {
    const row = this.heldRow({ stripeInvoiceId, token });
    if (!row) return;
    if (row.issuedLicense) this.rows.set(stripeInvoiceId, { ...row, claimedAt: RELEASED_AT });
    else this.rows.delete(stripeInvoiceId);
  }

  private heldRow({
    stripeInvoiceId,
    token,
  }: {
    stripeInvoiceId: string;
    token: string;
  }): ClaimRow | undefined {
    const row = this.rows.get(stripeInvoiceId);
    return row && row.claimToken === token && !row.deliveredAt ? row : undefined;
  }
}
