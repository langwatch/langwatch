// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  type BillingReportOrganization,
  BillingReportOrganizationPort,
} from "../../ports/billing-report-organization.port";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type BillingReportOrganizationDatabase = Pick<PrismaClient, "organization">;

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
 *     organization on any other model is skipped, not reported as zero.
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
export class PrismaBillingReportOrganizationRepository extends BillingReportOrganizationPort {
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
  ): Promise<BillingReportOrganization | null> {
    return this.prisma.organization.findFirst({
      where: { id: organizationId, pricingModel: "SEAT_EVENT" },
      select: {
        id: true,
        stripeCustomerId: true,
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
  }
}
