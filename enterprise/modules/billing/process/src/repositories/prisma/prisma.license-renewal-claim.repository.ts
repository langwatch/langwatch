// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { generate } from "@langwatch/ksuid";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  LicenseRenewalClaimRepository,
  type IssuedRenewalLicense,
  type LicenseRenewalClaimOutcome,
} from "../license-renewal-claim.repository.ts";

type LicenseRenewalClaimDatabase = Pick<PrismaClient, "licenseRenewalClaim">;

/** A released claim with a minted licence keeps its row; this lease is long over. */
const RELEASED_AT = new Date(0);

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
    const token = generate("billing").toString();
    const { count } = await this.prisma.licenseRenewalClaim.createMany({
      data: [{ stripeInvoiceId, stripeSubscriptionId, claimToken: token, claimedAt: toDate(now) }],
      skipDuplicates: true,
    });
    if (count === 1) return { outcome: "claimed", token, issued: null };

    const existing = await this.prisma.licenseRenewalClaim.findUnique({
      where: { stripeInvoiceId },
    });
    // Released between the insert and the read: the next delivery claims it afresh.
    if (!existing) return { outcome: "in_flight" };
    if (existing.deliveredAt) return { outcome: "delivered" };
    if (existing.claimedAt.getTime() > now.epochMilliseconds - leaseMs)
      return { outcome: "in_flight" };

    const takeover = await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId, claimToken: existing.claimToken, deliveredAt: null },
      data: { claimToken: token, claimedAt: toDate(now) },
    });
    if (takeover.count !== 1) return { outcome: "in_flight" };
    // Read after the takeover: the stale holder may have kept a licence since the first read.
    const taken = await this.prisma.licenseRenewalClaim.findUnique({ where: { stripeInvoiceId } });
    const kept = issuedRenewalLicenseSchema.safeParse(taken?.issuedLicense);
    return { outcome: "claimed", token, issued: kept.success ? kept.data : null };
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
    const { count } = await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId, claimToken: token, deliveredAt: null },
      data: { issuedLicense: issued, licenseId: issued.licenseData.licenseId },
    });
    return count === 1;
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
    const { count } = await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId, claimToken: token, deliveredAt: null },
      data: { deliveredAt: toDate(deliveredAt), licenseId, issuedLicense: Prisma.DbNull },
    });
    return count === 1;
  }

  async release({
    stripeInvoiceId,
    token,
  }: {
    stripeInvoiceId: string;
    token: string;
  }): Promise<void> {
    await this.prisma.licenseRenewalClaim.deleteMany({
      where: {
        stripeInvoiceId,
        claimToken: token,
        deliveredAt: null,
        issuedLicense: { equals: Prisma.DbNull },
      },
    });
    await this.prisma.licenseRenewalClaim.updateMany({
      where: { stripeInvoiceId, claimToken: token, deliveredAt: null },
      data: { claimedAt: RELEASED_AT },
    });
  }
}

const issuedRenewalLicenseSchema = z.object({
  licenseKey: z.string().min(1),
  licenseData: z.object({
    licenseId: z.string(),
    plan: z.object({ type: z.string() }),
    expiresAt: z.string(),
    organizationName: z.string(),
  }),
});
