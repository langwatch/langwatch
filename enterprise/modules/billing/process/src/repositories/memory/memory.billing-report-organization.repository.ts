// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GROWTH_SEAT_PLAN_TYPES } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";

import {
  type BillingReportOrganizationLookup,
  BillingReportOrganizationRepository,
} from "../billing-report-organization.repository.ts";
import type { BillingSubscriptionRecord } from "../subscription.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The one pricing model that makes a month reportable at all. */
const USAGE_BILLED = "SEAT_EVENT";

/** The Prisma twin's bound on growth-seat subscriptions read. */
const GROWTH_SEAT_PERIODS_READ = 50;

/** Postgres `ORDER BY "startDate" DESC`: newest start first, and a missing start before any. */
function newestStartFirst(a: BillingSubscriptionRecord, b: BillingSubscriptionRecord): number {
  if (a.startDate === null || b.startDate === null) {
    return (b.startDate === null ? 1 : 0) - (a.startDate === null ? 1 : 0);
  }
  return Temporal.Instant.compare(b.startDate, a.startDate);
}

/**
 * The monthly roll-up's organization read, over the store. Every predicate the
 * Prisma twin states is part of the answer here too: the pricing model decides
 * the outcome, the subscriptions are growth-seat ones, ACTIVE or ended with a start, and they
 * come back in the order Postgres returns them.
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
          growthSeatPlans.includes(subscription.plan) &&
          (subscription.status === "ACTIVE" ||
            (subscription.endDate !== null && subscription.startDate !== null)),
      )
      .toSorted(newestStartFirst)
      .slice(0, GROWTH_SEAT_PERIODS_READ);

    return {
      outcome: "usage_billed",
      organization: {
        id: organization.id,
        stripeCustomerId: organization.stripeCustomerId,
        subscriptions: subscriptions
          .filter((subscription) => subscription.status === "ACTIVE")
          .slice(0, 1)
          .map((subscription) => ({ id: subscription.id })),
        contract: "cloud",
        growthSeatPeriods: subscriptions.map((subscription) => ({
          startMs: subscription.startDate?.epochMilliseconds ?? null,
          endMs: subscription.endDate?.epochMilliseconds ?? null,
        })),
      },
    };
  }

  async findPiiRedactionModelAcceptedAt({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    return (
      this.store.organizations.get(organizationId)?.piiRedactionModelAcceptedAt
        ?.epochMilliseconds ?? null
    );
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
        // ADR-174 decision 23 (proposed in v22) covers a Cloud upgrade; a connected month is read whole.
        growthSeatPeriods: [],
      },
    };
  }
}
