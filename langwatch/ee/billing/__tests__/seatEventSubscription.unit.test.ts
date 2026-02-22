import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/growthSeatEvent", () => ({
  createCheckoutLineItems: vi.fn().mockReturnValue([
    { price: "price_seat", quantity: 3 },
    { price: "price_events" },
  ]),
  isGrowthSeatPrice: vi.fn(),
  resolveGrowthSeatPriceId: vi.fn().mockReturnValue("price_seat"),
}));

import { isGrowthSeatPrice } from "../utils/growthSeatEvent";
import { createSeatEventSubscriptionFns } from "../services/seatEventSubscription";
import {
  NoActiveSubscriptionError,
  SubscriptionItemNotFoundError,
} from "../errors";

const mockIsGrowthSeatPrice = isGrowthSeatPrice as ReturnType<typeof vi.fn>;

const createMockStripe = () => ({
  checkout: {
    sessions: {
      create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/session_123" }),
    },
  },
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn(),
  },
  billingPortal: {
    sessions: {
      create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/portal_123" }),
    },
  },
  invoices: {
    retrieveUpcoming: vi.fn(),
  },
});

const createMockDb = () => {
  const subscriptionMock = {
    create: vi.fn().mockResolvedValue({ id: "sub_local_1" }),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };

  const organizationInviteMock = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };

  return {
    subscription: subscriptionMock,
    organization: {
      findUnique: vi.fn(),
    },
    organizationInvite: organizationInviteMock,
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        subscription: {
          create: subscriptionMock.create,
        },
        organizationInvite: {
          findFirst: organizationInviteMock.findFirst,
          create: organizationInviteMock.create,
        },
      };
      return fn(tx);
    }),
  };
};

describe("seatEventSubscriptionFns", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let db: ReturnType<typeof createMockDb>;
  let fns: ReturnType<typeof createSeatEventSubscriptionFns>;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    db = createMockDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fns = createSeatEventSubscriptionFns({ stripe: stripe as any, db: db as any });
  });

  describe("createSeatEventCheckout", () => {
    it("creates a PENDING subscription and Stripe checkout session", async () => {
      const result = await fns.createSeatEventCheckout({
        organizationId: "org_1",
        customerId: "cus_1",
        baseUrl: "https://app.langwatch.ai",
        currency: "EUR",
        billingInterval: "monthly",
        membersToAdd: 3,
      });

      expect(db.subscription.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          status: "PENDING",
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          maxMembers: 3,
        },
      });

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          customer: "cus_1",
          line_items: [
            { price: "price_seat", quantity: 3 },
            { price: "price_events" },
          ],
          metadata: {
            selectedCurrency: "EUR",
            selectedBillingInterval: "monthly",
          },
          subscription_data: expect.objectContaining({
            metadata: {
              selectedCurrency: "EUR",
              selectedBillingInterval: "monthly",
            },
          }),
          success_url: "https://app.langwatch.ai/settings/subscription?success",
          cancel_url: "https://app.langwatch.ai/settings/subscription",
          client_reference_id: "subscription_setup_sub_local_1",
        }),
      );

      expect(result).toEqual({ url: "https://checkout.stripe.com/session_123" });
    });

    describe("when creating a new checkout", () => {
      it("cancels stale PENDING subs for the organization", async () => {
        await fns.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.langwatch.ai",
          currency: "EUR",
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(db.subscription.updateMany).toHaveBeenCalledWith({
          where: { organizationId: "org_1", plan: { in: ["GROWTH_SEAT_EUR_MONTHLY", "GROWTH_SEAT_EUR_ANNUAL", "GROWTH_SEAT_USD_MONTHLY", "GROWTH_SEAT_USD_ANNUAL"] }, status: "PENDING" },
          data: { status: "CANCELLED", endDate: expect.any(Date) },
        });
      });

      it("stores maxMembers matching membersToAdd on the PENDING subscription", async () => {
        await fns.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.langwatch.ai",
          currency: "EUR",
          billingInterval: "monthly",
          membersToAdd: 5,
        });

        expect(db.subscription.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ maxMembers: 5 }),
        });
      });
    });

    describe("when isUpgradeFromTiered is true", () => {
      it("appends upgraded_from=tiered to the success URL", async () => {
        await fns.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.langwatch.ai",
          currency: "EUR",
          billingInterval: "monthly",
          membersToAdd: 3,
          isUpgradeFromTiered: true,
        });

        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            success_url: "https://app.langwatch.ai/settings/subscription?success&upgraded_from=tiered",
          }),
        );
      });
    });

    describe("when isUpgradeFromTiered is false", () => {
      it("uses a plain success URL without upgrade params", async () => {
        await fns.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.langwatch.ai",
          currency: "EUR",
          billingInterval: "monthly",
          membersToAdd: 3,
          isUpgradeFromTiered: false,
        });

        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            success_url: "https://app.langwatch.ai/settings/subscription?success",
          }),
        );
      });
    });
  });

  describe("updateSeatEventItems", () => {
    describe("when subscription exists with seat item", () => {
      it("updates Stripe subscription quantity and local maxMembers", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              { id: "si_seat", price: { id: "price_seat_eur_monthly" } },
              { id: "si_events", price: { id: "price_events_eur_monthly" } },
            ],
          },
        });

        mockIsGrowthSeatPrice.mockImplementation(
          (id: string) => id === "price_seat_eur_monthly",
        );

        const result = await fns.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 7,
        });

        expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
          items: [{ id: "si_seat", quantity: 7 }],
        });

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_local_1" },
          data: { status: "ACTIVE", maxMembers: 7, endDate: null },
        });

        expect(result).toEqual({ success: true });
      });
    });

    describe("when no subscription exists", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        const result = await fns.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(result).toEqual({ success: false });
      });
    });

    describe("when no seat item found on Stripe subscription", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              { id: "si_other", price: { id: "price_other" } },
            ],
          },
        });

        mockIsGrowthSeatPrice.mockReturnValue(false);

        const result = await fns.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe("previewProration", () => {
    describe("when subscription exists with seat item", () => {
      it("returns incremental proration excluding pre-existing prorations", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [{ id: "si_seat", price: { id: "price_seat_eur_monthly", unit_amount: 2900, recurring: { interval: "month" } } }],
          },
        });
        mockIsGrowthSeatPrice.mockImplementation((id: string) => id === "price_seat_eur_monthly");
        // First call: with proposed change (includes pre-existing + new prorations)
        // Second call: current state (only pre-existing prorations)
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "eur",
            lines: {
              data: [
                { proration: true, amount: 1450 },
                { proration: true, amount: -967 },
                { proration: true, amount: 500 },  // pre-existing
                { proration: false, amount: 11600 },
              ],
            },
          })
          .mockResolvedValueOnce({
            currency: "eur",
            lines: {
              data: [
                { proration: true, amount: 500 },  // same pre-existing
                { proration: false, amount: 8700 },
              ],
            },
          });

        const result = await fns.previewProration({ organizationId: "org_1", newTotalSeats: 4 });

        // (1450 - 967 + 500) - (500) = 483 cents = €4.83
        expect(result.formattedAmountDue).toBe("€4.83");
      });

      it("returns formatted recurring total based on new seat count", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [{ id: "si_seat", price: { id: "price_seat_eur_monthly", unit_amount: 2900, recurring: { interval: "month" } } }],
          },
        });
        mockIsGrowthSeatPrice.mockImplementation((id: string) => id === "price_seat_eur_monthly");
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [{ proration: false, amount: 11600 }] },
          })
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [{ proration: false, amount: 8700 }] },
          });

        const result = await fns.previewProration({ organizationId: "org_1", newTotalSeats: 4 });

        expect(result.formattedRecurringTotal).toBe("€116");
      });

      it("returns the billing interval from the seat price", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [{ id: "si_seat", price: { id: "price_seat_eur_monthly", unit_amount: 2900, recurring: { interval: "month" } } }],
          },
        });
        mockIsGrowthSeatPrice.mockImplementation((id: string) => id === "price_seat_eur_monthly");
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [] },
          })
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [] },
          });

        const result = await fns.previewProration({ organizationId: "org_1", newTotalSeats: 4 });

        expect(result.billingInterval).toBe("month");
      });
    });

    describe("when no subscription exists", () => {
      it("throws NoActiveSubscriptionError", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        await expect(fns.previewProration({ organizationId: "org_1", newTotalSeats: 4 }))
          .rejects.toThrow(NoActiveSubscriptionError);
      });
    });

    describe("when no seat item found on subscription", () => {
      it("throws SubscriptionItemNotFoundError", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_local_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: "ACTIVE",
        });
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: { data: [{ id: "si_other", price: { id: "price_other" } }] },
        });
        mockIsGrowthSeatPrice.mockReturnValue(false);

        await expect(fns.previewProration({ organizationId: "org_1", newTotalSeats: 4 }))
          .rejects.toThrow(SubscriptionItemNotFoundError);
      });
    });
  });

  describe("seatEventBillingPortalUrl", () => {
    it("creates billing portal session with subscription return URL", async () => {
      const result = await fns.seatEventBillingPortalUrl({
        customerId: "cus_1",
        baseUrl: "https://app.langwatch.ai",
      });

      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_1",
        return_url: "https://app.langwatch.ai/settings/subscription",
      });

      expect(result).toEqual({ url: "https://billing.stripe.com/portal_123" });
    });
  });
});
