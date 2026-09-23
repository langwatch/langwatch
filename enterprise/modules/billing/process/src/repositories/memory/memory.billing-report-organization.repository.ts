// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";

import {
  type BillingReportOrganizationLookup,
  BillingReportOrganizationRepository,
} from "../organization/billing-report-organization.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/** The one pricing model that makes a month reportable at all. */
const USAGE_BILLED = "SEAT_EVENT";

/**
 * The monthly roll-up's organization read, over the store. Every predicate the
 * Prisma twin states is part of the answer here too: the pricing model decides
 * the outcome, and the subscription must be ACTIVE on a growth-seat plan.
 */
export class MemoryBillingReportOrganizationRepository extends BillingReportOrganizationRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingReportOrganizationRepository {
    return new MemoryBillingReportOrganizationRepository(store);
  }

  async getOrganizationForBilling(
    organizationId: string,
  ): Promise<BillingReportOrganizationLookup> {
    const organization = this.store.organizations.get(organizationId);
    if (!organization) return { outcome: "not_found" };
    if (organization.pricingModel !== USAGE_BILLED) {
      // A connected self-hosted customer buys no Cloud plan, so it never
      // reaches SEAT_EVENT pricing; its hosted usage rides the quarterly
      // subscription its billing account names (ADR-156 section 7).
      return organization.selfHostedCustomer
        ? this.connectedOrganizationForBilling(organizationId)
        : { outcome: "not_usage_billed" };
    }

    const growthSeatPlans: readonly string[] = GROWTH_SEAT_PLAN_TYPES;
    const subscriptions = this.store.subscriptions
      .filter(
        (subscription) =>
          subscription.organizationId === organizationId &&
          subscription.status === "ACTIVE" &&
          growthSeatPlans.includes(subscription.plan),
      )
      .slice(0, 1)
      .map((subscription) => ({ id: subscription.id }));

    return {
      outcome: "usage_billed",
      organization: {
        id: organization.id,
        stripeCustomerId: organization.stripeCustomerId,
        subscriptions,
        contract: "cloud",
      },
    };
  }

  private connectedOrganizationForBilling(organizationId: string): BillingReportOrganizationLookup {
    const account = this.store.connectedBillingAccounts.get(organizationId);
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
