// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see modules/staff-access/specs/staff-access-functions-billing.feature */
import type { StripePriceDetail } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStripePricesChannel } from "../../channels/memory/memory.stripe-prices.channel.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryOverPlanRepository } from "../../repositories/memory/memory.over-plan.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { OrganizationPricingRepository } from "../../repositories/organization-pricing.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { BillingOpsFactsService } from "../billing-ops-facts.service.ts";
import { OrganizationPricingService } from "../organization-pricing.service.ts";

const at = (iso: string) => Temporal.Instant.from(iso);

function row(
  overrides: Partial<BillingSubscriptionRecord> & { id: string },
): BillingSubscriptionRecord {
  return {
    organizationId: "org-acme",
    status: "ACTIVE",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    stripeSubscriptionId: null,
    createdAt: at("2026-11-01T00:00:00Z"),
    startDate: null,
    endDate: null,
    maxMembers: null,
    maxMembersLite: null,
    maxMembersDeveloper: null,
    maxMessagesPerMonth: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
    ...overrides,
  };
}

const price = (id: string, lookupKey: string | null, active = true): StripePriceDetail => ({
  id,
  active,
  livemode: true,
  product: `prod_${id}`,
  unitAmount: 2900,
  currency: "eur",
  type: "recurring",
  recurring: { interval: "month", intervalCount: 1 },
  nickname: null,
  lookupKey,
  metadata: {},
});

function compose({ isSaas = true, withStripe = true } = {}) {
  const store = MemoryBillingStore.create();
  const pricingModels: OrganizationPricingRepository = {
    findPricingModel: async (organizationId) =>
      organizationId === "org-acme" ? "SEAT_EVENT" : null,
  };
  const prices = MemoryStripePricesChannel.create();
  const service = BillingOpsFactsService.create({
    isSaas,
    subscriptions: MemoryBillingSubscriptionRepository.create(store),
    overPlan: MemoryOverPlanRepository.create(store),
    pricing: OrganizationPricingService.create(pricingModels),
    ...(withStripe ? { prices } : {}),
  });
  return { store, prices, service };
}

describe("billing ops facts", () => {
  describe("given ACME with a cancelled and an active subscription", () => {
    it("answers the active one, counts by state and the last cancellation", async () => {
      const { store, service } = compose();
      store.subscriptions.push(
        row({
          id: "sub-old",
          status: "CANCELLED",
          plan: "GROWTH",
          createdAt: at("2026-06-01T00:00:00Z"),
          endDate: at("2026-10-01T00:00:00Z"),
        }),
        row({
          id: "sub-new",
          stripeSubscriptionId: "sub_stripe",
          startDate: at("2026-11-01T00:05:00Z"),
          maxMembers: 5,
          paymentRecoveryStartedAt: at("2026-11-20T00:00:00Z"),
          paymentRecoveryNoticeDay: 3,
        }),
        row({ id: "sub-globex", organizationId: "org-globex" }),
      );

      const facts = await service.getOrganizationBillingFacts({ organizationId: "org-acme" });

      expect(facts).toMatchObject({
        organizationId: "org-acme",
        pricingModel: "seat_event",
        current: {
          subscriptionId: "sub-new",
          state: "active",
          linkedToStripe: true,
          fullSeats: 5,
          paymentRecoveryNoticeDay: 3,
        },
        subscriptionsByState: [
          { state: "active", count: 1 },
          { state: "cancelled", count: 1 },
        ],
        lastCancelledAt: at("2026-10-01T00:00:00Z").epochMilliseconds,
        overPlanSince: null,
      });
    });
  });

  describe("given subscriptions created across two months", () => {
    it("counts November's per plan and state, with the activated ones and organizations", async () => {
      const { store, service } = compose();
      store.subscriptions.push(
        row({
          id: "a",
          startDate: at("2026-11-02T00:00:00Z"),
          createdAt: at("2026-11-02T00:00:00Z"),
        }),
        row({
          id: "b",
          organizationId: "org-globex",
          status: "PENDING",
          createdAt: at("2026-11-03T00:00:00Z"),
        }),
        row({
          id: "c",
          organizationId: "org-initech",
          status: "PENDING",
          createdAt: at("2026-11-04T00:00:00Z"),
        }),
        row({ id: "d", createdAt: at("2026-10-20T00:00:00Z") }),
      );

      const counts = await service.findSubscriptionCounts({
        since: at("2026-11-01T00:00:00Z"),
        until: at("2026-12-01T00:00:00Z"),
      });

      expect(counts).toEqual(
        expect.arrayContaining([
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "active",
            subscriptions: 1,
            activated: 1,
            organizations: 1,
          },
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "pending",
            subscriptions: 2,
            activated: 0,
            organizations: 2,
          },
        ]),
      );
      expect(counts).toHaveLength(2);
    });
  });

  describe("given the Stripe account's prices", () => {
    it("answers each with its catalogue name and tax behaviour", async () => {
      const { prices, service } = compose();
      prices.seed({
        price: price("price_seat", "GROWTH_SEAT_EUR_MONTHLY"),
        taxBehavior: "exclusive",
      });
      prices.seed({ price: price("price_old", "acme_custom", false) });

      await expect(service.findStripePriceFacts()).resolves.toEqual([
        expect.objectContaining({
          priceId: "price_seat",
          catalogueName: "GROWTH_SEAT_EUR_MONTHLY",
          taxBehavior: "exclusive",
          active: true,
          interval: "month",
        }),
        expect.objectContaining({
          priceId: "price_old",
          catalogueName: "other",
          taxBehavior: null,
          active: false,
        }),
      ]);
    });
  });

  describe("when the deployment is not LangWatch Cloud", () => {
    it("refuses every read by name", async () => {
      const { service } = compose({ isSaas: false });

      for (const read of [
        service.getOrganizationBillingFacts({ organizationId: "org-acme" }),
        service.findSubscriptionCounts({
          since: at("2026-11-01T00:00:00Z"),
          until: at("2026-11-02T00:00:00Z"),
        }),
        service.findStripePriceFacts(),
      ]) {
        await expect(read).rejects.toMatchObject({
          code: "billing_facts_unavailable",
          meta: { reason: "not_cloud" },
        });
      }
    });
  });

  describe("when Cloud holds no Stripe key", () => {
    /** @scenario "billing.stripe_prices refuses where no payment provider is configured" */
    it("refuses the price catalogue by name", async () => {
      const { service } = compose({ withStripe: false });

      await expect(service.findStripePriceFacts()).rejects.toMatchObject({
        code: "billing_facts_unavailable",
        meta: { reason: "no_payment_provider" },
      });
    });
  });
});
