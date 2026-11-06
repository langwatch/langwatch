// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import {
  LicenseRenewalClaimRepository,
  type LicenseRenewalClaimOutcome,
} from "../license-renewal-claim.repository.ts";

type LicenseRenewalClaimDatabase = Pick<PrismaClient, "licenseRenewalClaim">;

/** The renewal claim over its own table: the invoice id is the primary key. */
export class PrismaLicenseRenewalClaimRepository extends LicenseRenewalClaimRepository {
  private constructor(private readonly prisma: LicenseRenewalClaimDatabase) {
    super();
  }

  static create(prisma: LicenseRenewalClaimDatabase): PrismaLicenseRenewalClaimRepository {
    return new PrismaLicenseRenewalClaimRepository(prisma);
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
    const { count } = await this.prisma.licenseRenewalClaim.createMany({
      data: [{ stripeInvoiceId, stripeSubscriptionId, claimedAt: toDate(now) }],
      skipDuplicates: true,
    });
    if (count === 1) return "claimed";

    const existing = await this.prisma.licenseRenewalClaim.findUnique({
      where: { stripeInvoiceId },
    });
    // Released between the insert and the read: the next delivery claims it afresh.
    if (!existing) return "in_flight";
    if (existing.deliveredAt) return "delivered";
    if (existing.claimedAt.getTime() > now.epochMilliseconds - leaseMs) return "in_flight";

    const takeover = await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId, claimedAt: existing.claimedAt, deliveredAt: null },
      data: { claimedAt: toDate(now) },
    });
    return takeover.count === 1 ? "claimed" : "in_flight";
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
    await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId },
      data: { deliveredAt: toDate(deliveredAt), licenseId },
    });
  }

  async release({ stripeInvoiceId }: { stripeInvoiceId: string }): Promise<void> {
    await this.prisma.licenseRenewalClaim.deleteMany({
      where: { stripeInvoiceId, deliveredAt: null },
    });
  }
}
