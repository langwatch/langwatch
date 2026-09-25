// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type BillingReportOrganizationLookup,
  BillingReportOrganizationRepository,
} from "../billing-report-organization.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type BillingReportOrganizationDatabase = Pick<
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
 *   - the subscription filter is `ACTIVE` and a growth-seat plan, because a
 *     cancelled or non-seat subscription cannot carry a meter event.
 *   - `take: 1` with `orderBy: startDate desc` reads the CURRENT one; the
 *     command only asks whether one exists, and reading them all would make a
 *     long-lived organization pay for rows it never looks at.
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
            status: "ACTIVE",
            plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
          },
          take: 1,
          select: { id: true },
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

    const {
      pricingModel: _pricingModel,
      selfHostedCustomer: _selfHostedCustomer,
      ...forBilling
    } = organization;

    return { outcome: "usage_billed", organization: { ...forBilling, contract: "cloud" } };
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
      },
    };
  }
}
