// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillingFactsUnavailableError,
  type BillingFactState,
  type BillingFactSubscription,
  type BillingStripePriceFact,
  type BillingSubscriptionCount,
  type OrganizationBillingFacts,
} from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

import type { StripePricesChannel } from "../channels/stripe-prices.channel.ts";
import type { OverPlanRepository } from "../repositories/over-plan.repository.ts";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
} from "../repositories/subscription.repository.ts";
import {
  catalogueNameOf,
  billingOrderOf,
  factPlanOf,
  factStateOf,
  pricingModelCodeOf,
  taxBehaviorOf,
} from "../rules/billing-ops-facts.rules.ts";
import type { OrganizationPricingService } from "./organization-pricing.service.ts";

const PRICE_PAGE = 100;
const MAX_PRICE_PAGES = 50;

type OpsFactsDeps = Readonly<{
  isSaas: boolean;
  subscriptions: Pick<BillingSubscriptionRepository, "findForOrganization" | "findCreatedBetween">;
  overPlan: Pick<OverPlanRepository, "findOpenForOrganization">;
  pricing: Pick<OrganizationPricingService, "getPricingModel">;
  /** Billing's Stripe prices; absent where the deployment holds no key. */
  prices?: Pick<StripePricesChannel, "listPriceTaxes">;
}>;

/**
 * Billing's ops reads (ADR-202, amendment 2026-11-25): an organization's subscription facts,
 * subscription counts over a range, and the Stripe price catalogue. Codes and times only.
 * Spec: modules/staff-access/specs/staff-access-functions-billing.feature
 */
export class BillingOpsFactsService {
  private constructor(private readonly deps: OpsFactsDeps) {}

  static create(deps: OpsFactsDeps): BillingOpsFactsService {
    return new BillingOpsFactsService(deps);
  }

  /** @throws {BillingFactsUnavailableError} off LangWatch Cloud */
  async getOrganizationBillingFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationBillingFacts> {
    this.requireCloud();
    const [rows, marks, { pricingModel }] = await Promise.all([
      this.deps.subscriptions.findForOrganization(organizationId),
      this.deps.overPlan.findOpenForOrganization(organizationId),
      this.deps.pricing.getPricingModel({ organizationId }),
    ]);
    const [current] = billingOrderOf(rows);
    const byState = new Map<BillingFactState, number>();
    for (const row of rows) {
      const state = factStateOf(row.status);
      byState.set(state, (byState.get(state) ?? 0) + 1);
    }
    const cancelledEnds = rows
      .filter((row) => row.status === "CANCELLED" && row.endDate !== null)
      .map((row) => row.endDate?.epochMilliseconds ?? 0);
    return {
      organizationId,
      pricingModel: pricingModelCodeOf(pricingModel),
      current: current ? subscriptionFactOf(current) : null,
      subscriptionsByState: [...byState]
        .map(([state, count]) => ({ state, count }))
        .toSorted((a, b) => a.state.localeCompare(b.state)),
      lastCancelledAt: cancelledEnds.length === 0 ? null : Math.max(...cancelledEnds),
      overPlanSince: marks[0]?.since.epochMilliseconds ?? null,
    };
  }

  /** @throws {BillingFactsUnavailableError} off LangWatch Cloud */
  async findSubscriptionCounts({
    since,
    until,
  }: {
    since: Instant;
    until: Instant;
  }): Promise<BillingSubscriptionCount[]> {
    this.requireCloud();
    const rows = await this.deps.subscriptions.findCreatedBetween({ since, until });
    const groups = new Map<string, { row: BillingSubscriptionCount; orgs: Set<string> }>();
    for (const row of rows) {
      const plan = factPlanOf(row.plan);
      const state = factStateOf(row.status);
      const key = `${plan}/${state}`;
      const group = groups.get(key) ?? {
        row: { plan, state, subscriptions: 0, activated: 0, organizations: 0 },
        orgs: new Set<string>(),
      };
      group.orgs.add(row.organizationId);
      group.row = {
        ...group.row,
        subscriptions: group.row.subscriptions + 1,
        activated: group.row.activated + (row.startDate === null ? 0 : 1),
        organizations: group.orgs.size,
      };
      groups.set(key, group);
    }
    return [...groups.values()].map(({ row }) => row);
  }

  /**
   * @throws {BillingFactsUnavailableError} off LangWatch Cloud or with no payment provider
   * @throws {Error} when the account holds more prices than one read pages through
   */
  async findStripePriceFacts(): Promise<BillingStripePriceFact[]> {
    this.requireCloud();
    const { prices } = this.deps;
    if (!prices) throw new BillingFactsUnavailableError({ reason: "no_payment_provider" });
    const facts: BillingStripePriceFact[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_PRICE_PAGES; page += 1) {
      const listed = await prices.listPriceTaxes({
        limit: PRICE_PAGE,
        ...(startingAfter === undefined ? {} : { startingAfter }),
      });
      for (const price of listed.prices) {
        facts.push({
          priceId: price.id,
          catalogueName: catalogueNameOf(price.lookupKey),
          currency: price.currency,
          unitAmount: price.unitAmount,
          interval: price.recurring?.interval ?? null,
          intervalCount: price.recurring?.intervalCount ?? null,
          taxBehavior: price.taxBehavior === null ? null : taxBehaviorOf(price.taxBehavior),
          active: price.active,
          livemode: price.livemode,
        });
      }
      startingAfter = listed.prices.at(-1)?.id;
      if (!listed.hasMore || startingAfter === undefined) return facts;
    }
    throw new Error(`The Stripe account holds more than ${MAX_PRICE_PAGES * PRICE_PAGE} prices`);
  }

  private requireCloud(): void {
    if (!this.deps.isSaas) throw new BillingFactsUnavailableError({ reason: "not_cloud" });
  }
}

function subscriptionFactOf(row: BillingSubscriptionRecord): BillingFactSubscription {
  return {
    subscriptionId: row.id,
    plan: factPlanOf(row.plan),
    state: factStateOf(row.status),
    createdAt: row.createdAt.epochMilliseconds,
    startedAt: row.startDate?.epochMilliseconds ?? null,
    endedAt: row.endDate?.epochMilliseconds ?? null,
    lastPaymentFailedAt: row.lastPaymentFailedDate?.epochMilliseconds ?? null,
    linkedToStripe: row.stripeSubscriptionId !== null,
    fullSeats: row.maxMembers,
    liteSeats: row.maxMembersLite,
    developerSeats: row.maxMembersDeveloper,
    eventsCap: row.maxMessagesPerMonth,
    retentionDays: row.maxRetentionDays ?? null,
    seatsKept: row.seatsKept,
    seatsKeptUntil: row.seatsKeptUntil?.epochMilliseconds ?? null,
    paymentRecoveryStartedAt: row.paymentRecoveryStartedAt?.epochMilliseconds ?? null,
    paymentRecoveryNoticeDay: row.paymentRecoveryNoticeDay ?? null,
  };
}
