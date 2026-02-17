import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  calculateQuantityForPrice,
  createItemsToAdd,
  getItemsToUpdate,
  prices,
} from "../stripeHelpers";
import { PlanTypes } from "../planTypes";

const createSubscriptionItem = (
  id: string,
  priceId: string,
): Stripe.SubscriptionItem =>
  ({
    id,
    price: { id: priceId },
  }) as Stripe.SubscriptionItem;

describe("stripeHelpers", () => {
  describe("getItemsToUpdate()", () => {
    it("updates launch items and deletes stale items from other plans", () => {
      const items = getItemsToUpdate({
        currentItems: [
          createSubscriptionItem("launch-base", prices.LAUNCH),
          createSubscriptionItem("launch-users", prices.LAUNCH_USERS),
          createSubscriptionItem("launch-traces", prices.LAUNCH_TRACES_10K),
          createSubscriptionItem("stale-acc-users", prices.ACCELERATE_USERS),
        ],
        plan: PlanTypes.LAUNCH,
        tracesToAdd: 45_000,
        membersToAdd: 8,
      });

      expect(items).toEqual([
        { id: "launch-traces", quantity: 2 },
        { id: "launch-users", quantity: 5 },
        { id: "launch-base", quantity: 1 },
        { id: "stale-acc-users", deleted: true },
      ]);
    });

    it("switches from launch to accelerate and removes launch-specific items", () => {
      const items = getItemsToUpdate({
        currentItems: [
          createSubscriptionItem("launch-base", prices.LAUNCH),
          createSubscriptionItem("launch-users", prices.LAUNCH_USERS),
          createSubscriptionItem("launch-traces", prices.LAUNCH_TRACES_10K),
        ],
        plan: PlanTypes.ACCELERATE,
        tracesToAdd: 250_000,
        membersToAdd: 9,
      });

      expect(items).toEqual([
        { price: prices.ACCELERATE_TRACES_100K, quantity: 2 },
        { price: prices.ACCELERATE_USERS, quantity: 4 },
        { price: prices.ACCELERATE, quantity: 1 },
        { id: "launch-base", deleted: true },
        { id: "launch-users", deleted: true },
        { id: "launch-traces", deleted: true },
      ]);
    });

    it("keeps PRO behavior without add-on item updates", () => {
      const items = getItemsToUpdate({
        currentItems: [createSubscriptionItem("pro-base", prices.PRO)],
        plan: PlanTypes.PRO,
        tracesToAdd: 10_000,
        membersToAdd: 5,
      });

      expect(items).toEqual([{ price: prices.PRO, quantity: 1 }]);
    });

    it("returns empty for FREE downgrade", () => {
      const items = getItemsToUpdate({ currentItems: [], plan: PlanTypes.FREE, tracesToAdd: 1_000, membersToAdd: 2 });

      expect(items).toEqual([]);
    });

    it("marks zero quantity add-ons as deleted", () => {
      const items = getItemsToUpdate({
        currentItems: [
          createSubscriptionItem("launch-base", prices.LAUNCH),
          createSubscriptionItem("launch-traces", prices.LAUNCH_TRACES_10K),
        ],
        plan: PlanTypes.LAUNCH,
        tracesToAdd: 20_000,
        membersToAdd: 3,
      });

      expect(items).toEqual([
        { id: "launch-traces", quantity: 0, deleted: true },
        { id: "launch-base", quantity: 1 },
      ]);
    });
  });

  describe("createItemsToAdd()", () => {
    it("creates launch add-on items when usage exceeds plan limits", () => {
      const items = createItemsToAdd(
        PlanTypes.LAUNCH,
        { quantity: 40_000 },
        { quantity: 8 },
      );

      expect(items).toEqual([
        { price: prices.LAUNCH_USERS, quantity: 5 },
        { price: prices.LAUNCH_TRACES_10K, quantity: 2 },
      ]);
    });

    it("creates accelerate add-on items with 100K traces buckets", () => {
      const items = createItemsToAdd(
        PlanTypes.ACCELERATE,
        { quantity: 250_000 },
        { quantity: 8 },
      );

      expect(items).toEqual([
        { price: prices.ACCELERATE_USERS, quantity: 3 },
        { price: prices.ACCELERATE_TRACES_100K, quantity: 2 },
      ]);
    });

    it("returns no add-ons for plans without add-on prices", () => {
      expect(
        createItemsToAdd(
          PlanTypes.GROWTH,
          { quantity: 200_000 },
          { quantity: 50 },
        ),
      ).toEqual([]);
    });
  });

  describe("calculateQuantityForPrice()", () => {
    it("calculates quantity for user add-ons", () => {
      expect(
        calculateQuantityForPrice({ priceId: prices.LAUNCH_USERS, quantity: 4, plan: PlanTypes.LAUNCH }),
      ).toBe(7);
      expect(
        calculateQuantityForPrice({
          priceId: prices.ACCELERATE_ANNUAL_USERS,
          quantity: 4,
          plan: PlanTypes.ACCELERATE_ANNUAL,
        }),
      ).toBe(9);
    });

    it("calculates quantity for 10K traces add-ons", () => {
      expect(
        calculateQuantityForPrice({
          priceId: prices.LAUNCH_TRACES_10K,
          quantity: 3,
          plan: PlanTypes.LAUNCH,
        }),
      ).toBe(50_000);
    });

    it("calculates quantity for 100K traces add-ons", () => {
      expect(
        calculateQuantityForPrice({
          priceId: prices.ACCELERATE_TRACES_100K,
          quantity: 2,
          plan: PlanTypes.ACCELERATE,
        }),
      ).toBe(220_000);
    });

    it("returns 0 for unknown price ids", () => {
      expect(calculateQuantityForPrice({ priceId: "unknown", quantity: 10, plan: PlanTypes.PRO })).toBe(0);
    });
  });
});
