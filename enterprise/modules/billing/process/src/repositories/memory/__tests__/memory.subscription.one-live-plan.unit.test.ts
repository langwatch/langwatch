// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The memory twins hold an organization to one live Stripe-backed plan, as the Postgres index does.
 * @see ../../../../../specs/billing.feature
 */
import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { BillingSubscriptionRecord } from "../../subscription.repository.ts";
import { MemoryBillingStore } from "../memory.billing.store.ts";
import { MemorySeatEventSubscriptionRepository } from "../memory.seat-event-subscription.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../memory.subscription.repository.ts";

const ORG = "org_acme";
const CREATED = Temporal.Instant.from("2026-11-01T00:00:00Z");

const row = (fields: Partial<BillingSubscriptionRecord>): BillingSubscriptionRecord => ({
  id: "sub_db",
  organizationId: ORG,
  status: SubscriptionStatus.PENDING,
  plan: "GROWTH_SEAT_EUR_MONTHLY",
  stripeSubscriptionId: null,
  createdAt: CREATED,
  startDate: null,
  endDate: null,
  maxMembers: 3,
  maxMembersLite: null,
  maxMembersDeveloper: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
  seatsKept: null,
  seatsKeptUntil: null,
  ...fields,
});

function world(rows: BillingSubscriptionRecord[]) {
  const store = MemoryBillingStore.create();
  store.organizations.set(ORG, {
    id: ORG,
    name: "ACME",
    stripeCustomerId: "cus_acme",
    pricingModel: "SEAT_EVENT",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  store.subscriptions.push(...rows);
  return {
    store,
    subscriptions: MemoryBillingSubscriptionRepository.create(store),
    seats: MemorySeatEventSubscriptionRepository.create(store),
    statusOf: (id: string) => store.subscriptions.find((each) => each.id === id)?.status,
  };
}

const live = row({
  id: "sub_live",
  status: SubscriptionStatus.ACTIVE,
  stripeSubscriptionId: "sub_s_live",
});

describe("given an organization with a live Stripe-backed seat plan", () => {
  describe("when a second linked row is activated", () => {
    /** @scenario "The database refuses a second live Stripe-backed plan for an organization" */
    it("refuses with subscription_already_active and leaves it as it was", async () => {
      const { subscriptions, statusOf } = world([
        live,
        row({ id: "sub_second", stripeSubscriptionId: "sub_s_second" }),
      ]);

      await expect(
        subscriptions.activate({ id: "sub_second", previousStatus: SubscriptionStatus.PENDING }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });
      expect(statusOf("sub_second")).toBe(SubscriptionStatus.PENDING);
    });
  });

  describe("when an active unlinked row is linked to a second Stripe subscription", () => {
    /** @scenario "The database refuses a second live Stripe-backed plan for an organization" */
    it("refuses the link", async () => {
      const { subscriptions, store } = world([
        live,
        row({ id: "sub_ops", status: SubscriptionStatus.ACTIVE }),
      ]);

      await expect(
        subscriptions.linkStripeId({ id: "sub_ops", stripeSubscriptionId: "sub_s_ops" }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });
      expect(store.subscriptions.find((each) => each.id === "sub_ops")?.stripeSubscriptionId).toBe(
        null,
      );
    });
  });

  describe("when a cancelled linked row is brought back by a seat change", () => {
    /** @scenario "The database refuses a second live Stripe-backed plan for an organization" */
    it("refuses the reactivation", async () => {
      const { seats, statusOf } = world([
        live,
        row({
          id: "sub_old",
          status: SubscriptionStatus.CANCELLED,
          stripeSubscriptionId: "sub_s_old",
        }),
      ]);

      await expect(
        seats.reactivateWithSeats({
          id: "sub_old",
          maxMembers: 4,
          kept: null,
          repairsUpTo: CREATED,
        }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });
      expect(statusOf("sub_old")).toBe(SubscriptionStatus.CANCELLED);
    });
  });

  describe("when the live plan is a tiered one a seat checkout replaces", () => {
    /** @scenario "The database refuses a second live Stripe-backed plan for an organization" */
    it("activates the seat plan beside it", async () => {
      const { subscriptions, statusOf } = world([
        row({
          id: "sub_tiered",
          plan: "LAUNCH",
          status: SubscriptionStatus.ACTIVE,
          stripeSubscriptionId: "sub_s_tiered",
        }),
        row({ id: "sub_seat", stripeSubscriptionId: "sub_s_seat" }),
      ]);

      await subscriptions.activate({ id: "sub_seat", previousStatus: SubscriptionStatus.PENDING });

      expect(statusOf("sub_seat")).toBe(SubscriptionStatus.ACTIVE);
    });
  });
});

describe("given an operator's active row with no Stripe link", () => {
  const operator = row({ id: "sub_ops", status: SubscriptionStatus.ACTIVE, maxMembers: 3 });
  const checkout = (id: string, maxMembers: number) => row({ id, maxMembers });

  describe("when a paid checkout is moved onto it", () => {
    /** @scenario "Two checkouts paid onto an operator's row keep the first one's plan" */
    it("links the row and gives it the checkout's seats", async () => {
      const { subscriptions, store, statusOf } = world([operator, checkout("sub_a", 5)]);

      await subscriptions.adoptCheckout({
        pendingId: "sub_a",
        liveId: "sub_ops",
        stripeSubscriptionId: "sub_s_a",
      });

      expect(store.subscriptions.find((each) => each.id === "sub_ops")).toMatchObject({
        stripeSubscriptionId: "sub_s_a",
        maxMembers: 5,
      });
      expect(statusOf("sub_a")).toBe(SubscriptionStatus.CANCELLED);
    });
  });

  describe("when a second checkout is moved onto it after the first linked it", () => {
    /** @scenario "Two checkouts paid onto an operator's row keep the first one's plan" */
    it("refuses with subscription_already_active and keeps the first checkout's plan", async () => {
      const { subscriptions, store, statusOf } = world([
        operator,
        checkout("sub_a", 5),
        checkout("sub_b", 9),
      ]);
      await subscriptions.adoptCheckout({
        pendingId: "sub_a",
        liveId: "sub_ops",
        stripeSubscriptionId: "sub_s_a",
      });

      await expect(
        subscriptions.adoptCheckout({
          pendingId: "sub_b",
          liveId: "sub_ops",
          stripeSubscriptionId: "sub_s_b",
        }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });
      expect(store.subscriptions.find((each) => each.id === "sub_ops")).toMatchObject({
        stripeSubscriptionId: "sub_s_a",
        maxMembers: 5,
      });
      expect(statusOf("sub_b")).toBe(SubscriptionStatus.PENDING);
    });

    /** @scenario "Two checkouts paid onto an operator's row keep the first one's plan" */
    it("refuses linking another Stripe id and accepts the same one again", async () => {
      const { subscriptions } = world([row({ ...operator, stripeSubscriptionId: "sub_s_a" })]);

      await expect(
        subscriptions.linkStripeId({ id: "sub_ops", stripeSubscriptionId: "sub_s_b" }),
      ).rejects.toMatchObject({ code: "subscription_already_active" });
      await expect(
        subscriptions.linkStripeId({ id: "sub_ops", stripeSubscriptionId: "sub_s_a" }),
      ).resolves.toEqual({ count: 1 });
    });
  });
});
