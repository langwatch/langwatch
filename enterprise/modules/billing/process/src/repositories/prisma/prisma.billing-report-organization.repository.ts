// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type BillingReportOrganizationLookup,
  BillingReportOrganizationRepository,
} from "../billing-report-organization.repository.ts";

/** Enough growth-seat subscriptions for any month's replacements; an organization has a handful. */
const GROWTH_SEAT_PERIODS_READ = 50;

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type BillingReportOrganizationDatabase = Pick<
  PrismaClient,
  "organization" | "connectedBillingAccount"
>;

/**
 * Prisma implementation of the monthly roll-up's one organization read.
 *
 * Frozen twin: the App answers the same question through
 * `PrismaOrganizationRepository.getOrganizationForBilling`
 * (`platform/app/src/server/app-layer/organizations/repositories/organization.prisma.repository.ts`),
 * and the two graphs report into ONE Stripe meter. They may only change
 * together. Every predicate below is part of the answer rather than an
 * optimisation:
 *
 *   - `pricingModel: SEAT_EVENT` is what makes a row reportable at all; an
 *     organization on any other model is skipped, not reported as zero. It is
 *     SELECTED rather than filtered on, so one query still answers both
 *     questions: filtering made a non-usage-billed organization
 *     indistinguishable from an absent row, and telling them apart afterwards
 *     would have cost a second query on the path this read keeps cheap.
 *   - the subscription filter is a growth-seat plan, ACTIVE or ended with a
 *     start: only an ACTIVE one carries a meter event, and the ended ones
 *     keep a month's Instant Evals window from moving when one is replaced.
 *   - `orderBy: startDate desc` (nulls first in Postgres) puts the CURRENT
 *     one first, and a bounded `take` spares a long-lived organization.
 *
 * The literal `"SEAT_EVENT"` rather than the generated enum member: the value
 * is the stored column's spelling, and this repository is the seam that names
 * it.
 */
export class PrismaBillingReportOrganizationRepository extends BillingReportOrganizationRepository {
  private constructor(private readonly prisma: BillingReportOrganizationDatabase) {
    super();
  }

  static create(
    prisma: BillingReportOrganizationDatabase,
  ): PrismaBillingReportOrganizationRepository {
    return new PrismaBillingReportOrganizationRepository(prisma);
  }

  async getOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganizationLookup> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: {
        id: true,
        pricingModel: true,
        stripeCustomerId: true,
        selfHostedCustomer: true,
        subscriptions: {
          where: {
            plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
            OR: [{ status: "ACTIVE" }, { endDate: { not: null }, startDate: { not: null } }],
          },
          take: GROWTH_SEAT_PERIODS_READ,
          select: { id: true, status: true, startDate: true, endDate: true },
          orderBy: { startDate: "desc" },
        },
      },
    });

    if (!organization) return { outcome: "not_found" };

    if (organization.pricingModel !== "SEAT_EVENT") {
      // A connected self-hosted customer buys no Cloud plan, so it never
      // reaches SEAT_EVENT pricing. Its hosted usage is still invoiced, on the
      // quarterly subscription its billing account names (ADR-156 section 7).
      // The second read runs only for an organization an operator marked as a
      // self-hosted customer, which is a handful of rows.
      return organization.selfHostedCustomer
        ? this.connectedOrganizationForBilling(organizationId)
        : { outcome: "not_usage_billed" };
    }

    const { id, stripeCustomerId, subscriptions } = organization;

    return {
      outcome: "usage_billed",
      organization: {
        id,
        stripeCustomerId,
        subscriptions: subscriptions
          .filter((subscription) => subscription.status === "ACTIVE")
          .slice(0, 1)
          .map((subscription) => ({ id: subscription.id })),
        contract: "cloud",
        growthSeatPeriods: subscriptions.map((subscription) => ({
          startMs: subscription.startDate?.getTime() ?? null,
          endMs: subscription.endDate?.getTime() ?? null,
        })),
      },
    };
  }

  async findPiiRedactionModelAcceptedAt({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { piiRedactionModelAcceptedAt: true },
    });

    return organization?.piiRedactionModelAcceptedAt?.getTime() ?? null;
  }

  /**
   * The billing identity of a connected self-hosted customer: the invoice
   * customer and the usage subscription live on its `ConnectedBillingAccount`,
   * not on the organization row, because it holds neither a Cloud customer nor
   * a Cloud subscription.
   */
  private async connectedOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganizationLookup> {
    const account = await this.prisma.connectedBillingAccount.findUnique({
      where: { organizationId },
      select: { stripeCustomerId: true, usageSubscriptionId: true },
    });
    if (!account) return { outcome: "not_usage_billed" };

    return {
      outcome: "usage_billed",
      organization: {
        id: organizationId,
        stripeCustomerId: account.stripeCustomerId,
        // Onboarding that stopped before the subscription existed leaves this
        // empty, and the caller skips the organization until it does.
        subscriptions: account.usageSubscriptionId ? [{ id: account.usageSubscriptionId }] : [],
        contract: "connected",
        // ADR-174 decision 23 (proposed in v22) covers a Cloud upgrade; a connected month is read whole.
        growthSeatPeriods: [],
      },
    };
  }
}
