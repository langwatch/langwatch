import { PricingModel, type PrismaClient } from "@prisma/client";

import { GROWTH_SEAT_PLAN_TYPES } from "../../../../ee/billing/utils/growthSeatEvent";

/**
 * The candidate query behind the scheduled billing meter sweep.
 *
 * The sweep is the durability guarantee for usage reporting: the per-event poke
 * covers the fast path, and this covers the two cases the poke structurally
 * cannot — a poke whose dispatch failed every retry, and an organization whose
 * last billable event of the month is its last event ever. An organization
 * missing from this set is one the safety net cannot rescue, so the predicate
 * errs towards inclusion.
 */
export interface BillingReportingCandidatesService {
  listOrganizationsToReport(params: {
    billingMonth: string;
  }): Promise<string[]>;
}

/**
 * Prisma-backed candidate query.
 *
 * Two sources, unioned:
 *
 *   1. **Currently reportable organizations.** Exactly the predicate
 *      `getOrganizationForBilling` applies before the command will report
 *      anything — SEAT_EVENT pricing, a Stripe customer, and at least one
 *      ACTIVE Growth-seat subscription. Matching it exactly is what keeps the
 *      sweep from minting dispatches the command would only skip.
 *   2. **Organizations already checkpointed for this month.** Once a month
 *      total has been reported at least once, that organization stays a
 *      candidate for that month even if the live read in (1) misses it — a
 *      Stripe webhook rewriting the subscription row, or a customer id still
 *      being provisioned, must not silently drop an organization out of the
 *      safety net for the tick that happens to land there.
 *
 * Neither model is project-scoped, so the projectId multitenancy middleware
 * does not apply; `BillingMeterCheckpoint` and `Subscription` are both on the
 * organizationId guard's deferred list, so a cross-organization read is
 * permitted here — which is the point, this is a platform-wide sweep rather
 * than a tenant-facing query.
 *
 * On a self-hosted build the first query returns nothing (no Stripe customers,
 * no Growth-seat subscriptions) and the second returns nothing (no checkpoints
 * are ever written), so the sweep costs two empty reads an hour and dispatches
 * nothing. That is why the sweep needs no `isSaas` gate of its own.
 */
export class PrismaBillingReportingCandidatesService
  implements BillingReportingCandidatesService
{
  constructor(private readonly prisma: PrismaClient) {}

  async listOrganizationsToReport({
    billingMonth,
  }: {
    billingMonth: string;
  }): Promise<string[]> {
    const [reportable, checkpointed] = await Promise.all([
      this.prisma.organization.findMany({
        where: {
          pricingModel: PricingModel.SEAT_EVENT,
          stripeCustomerId: { not: null },
          subscriptions: {
            some: {
              status: "ACTIVE",
              plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
            },
          },
        },
        select: { id: true },
      }),
      // One row per organization per month, so this stays a small scan even
      // without an index on `billingMonth` alone (the table's only index is
      // the `[organizationId, billingMonth]` unique, whose leading column this
      // predicate does not constrain).
      this.prisma.billingMeterCheckpoint.findMany({
        where: { billingMonth },
        select: { organizationId: true },
      }),
    ]);

    const organizationIds = new Set<string>(reportable.map((org) => org.id));
    for (const checkpoint of checkpointed) {
      organizationIds.add(checkpoint.organizationId);
    }

    return [...organizationIds];
  }
}
