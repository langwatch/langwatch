import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/growthSeatEvent", () => ({
  createCheckoutLineItems: vi.fn().mockReturnValue([
    { price: "price_seat_usd_monthly", quantity: 3 },
    { price: "price_events_usd_monthly" },
  ]),
  GROWTH_SEAT_PLAN_TYPES: [
    "GROWTH_SEAT_EUR_MONTHLY",
    "GROWTH_SEAT_EUR_ANNUAL",
    "GROWTH_SEAT_USD_MONTHLY",
    "GROWTH_SEAT_USD_ANNUAL",
  ],
  isGrowthSeatPrice: vi.fn((id: string) => id.startsWith("price_seat_")),
  resolveGrowthSeatPlanType: vi
    .fn()
    .mockReturnValue("GROWTH_SEAT_USD_MONTHLY"),
}));

import { createSeatEventSubscriptionFns } from "../services/seatEventSubscription";
import { SubscriptionStatus } from "../planTypes";
import {
  NoActiveSubscriptionError,
  SubscriptionItemNotFoundError,
} from "../errors";

// ── Mock factories ──────────────────────────────────────────────────────────

const createMockStripe = () => ({
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  invoices: {
    retrieveUpcoming: vi.fn(),
  },
  billingPortal: {
    sessions: {
      create: vi.fn(),
    },
  },
});

const createMockDb = () => ({
  subscription: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  organizationInvite: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: any) => Promise<any>) =>
    fn({
      subscription: {
        create: vi.fn().mockResolvedValue({ id: "sub_new_1" }),
      },
      organizationInvite: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    }),
  ),
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("seatEventSubscription", () => {
  let stripe: ReturnType<typeof createMockStripe>;
  let db: ReturnType<typeof createMockDb>;
  let service: ReturnType<typeof createSeatEventSubscriptionFns>;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    db = createMockDb();
    service = createSeatEventSubscriptionFns({
      stripe: stripe as any,
      db: db as any,
    });
  });

  // ── previewProration ────────────────────────────────────────────────────

  describe("previewProration()", () => {
    describe("when active subscription exists with a seat item", () => {
      beforeEach(() => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              {
                id: "si_seat",
                price: {
                  id: "price_seat_usd_monthly",
                  unit_amount: 2500,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        });
      });

      it("returns formatted proration amount and recurring total for USD", async () => {
        // "with change" invoice has $15 proration, "current" has $5 existing proration
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "usd",
            lines: {
              data: [
                { proration: true, amount: 1500 },
                { proration: false, amount: 5000 },
              ],
            },
          })
          .mockResolvedValueOnce({
            currency: "usd",
            lines: {
              data: [{ proration: true, amount: 500 }],
            },
          });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 4,
        });

        // 1000 cents = $10 (whole number, no decimals)
        expect(result.formattedAmountDue).toBe("$10");
        // 4 seats * $25 = $100 (whole number, no decimals)
        expect(result.formattedRecurringTotal).toBe("$100");
        expect(result.billingInterval).toBe("month");
      });

      it("returns formatted proration amount and recurring total for EUR", async () => {
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              {
                id: "si_seat",
                price: {
                  id: "price_seat_eur_monthly",
                  unit_amount: 2000,
                  recurring: { interval: "month" },
                },
              },
            ],
          },
        });

        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [{ proration: true, amount: 2000 }] },
          })
          .mockResolvedValueOnce({
            currency: "eur",
            lines: { data: [] },
          });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 5,
        });

        // EUR uses en-IE locale
        expect(result.formattedAmountDue).toBe("\u20AC20");
        expect(result.formattedRecurringTotal).toBe("\u20AC100");
      });

      it("formats whole-dollar amounts without decimals", async () => {
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [{ proration: true, amount: 5000 }] },
          })
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [] },
          });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 2,
        });

        // 5000 cents = $50, whole number => no decimals
        expect(result.formattedAmountDue).toBe("$50");
        // 2 * 2500 = 5000 cents = $50
        expect(result.formattedRecurringTotal).toBe("$50");
      });

      it("formats fractional amounts with two decimal places", async () => {
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [{ proration: true, amount: 1550 }] },
          })
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [{ proration: true, amount: 100 }] },
          });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 1,
        });

        // (1550 - 100) = 1450 cents = $14.50
        expect(result.formattedAmountDue).toBe("$14.50");
      });

      it("subtracts existing prorations to isolate incremental cost", async () => {
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "usd",
            lines: {
              data: [
                { proration: true, amount: 3000 },
                { proration: true, amount: 1000 },
              ],
            },
          })
          .mockResolvedValueOnce({
            currency: "usd",
            lines: {
              data: [{ proration: true, amount: 2000 }],
            },
          });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        // (3000 + 1000) - 2000 = 2000 cents = $20
        expect(result.formattedAmountDue).toBe("$20");
      });

      it("passes correct subscription_items to Stripe upstream invoice", async () => {
        stripe.invoices.retrieveUpcoming
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [] },
          })
          .mockResolvedValueOnce({
            currency: "usd",
            lines: { data: [] },
          });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 7,
        });

        expect(stripe.invoices.retrieveUpcoming).toHaveBeenCalledWith({
          subscription: "sub_stripe_1",
          subscription_items: [{ id: "si_seat", quantity: 7 }],
          subscription_proration_behavior: "create_prorations",
        });
      });
    });

    describe("when no active subscription exists", () => {
      it("throws NoActiveSubscriptionError", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toThrow(NoActiveSubscriptionError);
      });
    });

    describe("when Stripe subscription is not active", () => {
      it("throws NoActiveSubscriptionError", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "canceled",
          items: { data: [] },
        });

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toThrow(NoActiveSubscriptionError);
      });
    });

    describe("when no seat item found on subscription", () => {
      it("throws SubscriptionItemNotFoundError", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              {
                id: "si_events",
                price: { id: "price_events_usd_monthly" },
              },
            ],
          },
        });

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toThrow(SubscriptionItemNotFoundError);
      });
    });
  });

  // ── updateSeatEventItems ──────────────────────────────────────────────────

  describe("updateSeatEventItems()", () => {
    describe("when active subscription exists with a seat item", () => {
      beforeEach(() => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          canceled_at: null,
          items: {
            data: [
              { id: "si_seat", price: { id: "price_seat_usd_monthly" } },
            ],
          },
        });

        stripe.subscriptions.update.mockResolvedValue({});
      });

      it("updates Stripe subscription seat quantity", async () => {
        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
        });

        expect(result).toEqual({ success: true });
        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          "sub_stripe_1",
          { items: [{ id: "si_seat", quantity: 10 }] },
        );
      });

      it("updates DB subscription to ACTIVE with new seat count", async () => {
        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 8,
        });

        expect(db.subscription.update).toHaveBeenCalledWith({
          where: { id: "sub_db_1" },
          data: {
            status: SubscriptionStatus.ACTIVE,
            maxMembers: 8,
            endDate: null,
          },
        });
      });
    });

    describe("when subscription is scheduled for cancellation", () => {
      it("reactivates by setting cancel_at_period_end to false", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
          status: SubscriptionStatus.ACTIVE,
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          canceled_at: 1700000000,
          items: {
            data: [
              { id: "si_seat", price: { id: "price_seat_usd_monthly" } },
            ],
          },
        });

        stripe.subscriptions.update.mockResolvedValue({});

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          "sub_stripe_1",
          {
            cancel_at_period_end: false,
            items: [{ id: "si_seat", quantity: 5 }],
          },
        );
      });
    });

    describe("when no DB subscription has a stripe ID", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue(null);

        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(result).toEqual({ success: false });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      });
    });

    describe("when Stripe subscription status is not active", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "canceled",
          items: { data: [] },
        });

        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(result).toEqual({ success: false });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      });
    });

    describe("when no seat item found on Stripe subscription", () => {
      it("returns success false", async () => {
        db.subscription.findFirst.mockResolvedValue({
          id: "sub_db_1",
          stripeSubscriptionId: "sub_stripe_1",
        });

        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [
              {
                id: "si_events",
                price: { id: "price_events_usd_monthly" },
              },
            ],
          },
        });

        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(result).toEqual({ success: false });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      });
    });
  });

  // ── createSeatEventCheckout ───────────────────────────────────────────────

  describe("createSeatEventCheckout()", () => {
    describe("when stale PENDING subscriptions exist", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([
          { id: "stale_sub_1" },
          { id: "stale_sub_2" },
        ]);

        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("cancels stale PENDING subscriptions", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(db.subscription.updateMany).toHaveBeenCalledWith({
          where: {
            organizationId: "org_1",
            plan: {
              in: [
                "GROWTH_SEAT_EUR_MONTHLY",
                "GROWTH_SEAT_EUR_ANNUAL",
                "GROWTH_SEAT_USD_MONTHLY",
                "GROWTH_SEAT_USD_ANNUAL",
              ],
            },
            status: SubscriptionStatus.PENDING,
          },
          data: {
            status: SubscriptionStatus.CANCELLED,
            endDate: expect.any(Date),
          },
        });
      });

      it("deletes orphaned PAYMENT_PENDING invites from stale subs", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(db.organizationInvite.deleteMany).toHaveBeenCalledWith({
          where: {
            organizationId: "org_1",
            status: "PAYMENT_PENDING",
            subscriptionId: { in: ["stale_sub_1", "stale_sub_2"] },
          },
        });
      });
    });

    describe("when no stale subscriptions exist", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);

        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("skips invite cleanup", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 2,
        });

        expect(db.organizationInvite.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when creating checkout session", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);

        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session_abc",
        });
      });

      it("returns the checkout session URL", async () => {
        const result = await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(result).toEqual({
          url: "https://checkout.stripe.com/session_abc",
        });
      });

      it("creates Stripe checkout with correct line items and metadata", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            mode: "subscription",
            customer: "cus_1",
            line_items: [
              { price: "price_seat_usd_monthly", quantity: 3 },
              { price: "price_events_usd_monthly" },
            ],
            metadata: {
              selectedCurrency: "USD",
              selectedBillingInterval: "monthly",
            },
            client_reference_id: "subscription_setup_sub_new_1",
            allow_promotion_codes: true,
          }),
        );
      });

      it("sets success URL without upgrade param by default", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
        expect(callArgs.success_url).toBe(
          "https://app.test/settings/subscription?success",
        );
      });

      it("appends upgraded_from param when isUpgradeFromTiered is true", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
          isUpgradeFromTiered: true,
        });

        const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
        expect(callArgs.success_url).toBe(
          "https://app.test/settings/subscription?success&upgraded_from=tiered",
        );
      });

      it("sets billing_cycle_anchor to the 1st of next month", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        const callArgs = stripe.checkout.sessions.create.mock.calls[0]![0];
        const anchor =
          callArgs.subscription_data.billing_cycle_anchor as number;

        // Anchor should be a Unix timestamp for the 1st of next month
        const anchorDate = new Date(anchor * 1000);
        expect(anchorDate.getUTCDate()).toBe(1);
      });
    });
  });

  // ── seatEventBillingPortalUrl ─────────────────────────────────────────────

  describe("seatEventBillingPortalUrl()", () => {
    it("creates portal session and returns URL", async () => {
      stripe.billingPortal.sessions.create.mockResolvedValue({
        url: "https://billing.stripe.com/portal",
      });

      const result = await service.seatEventBillingPortalUrl({
        customerId: "cus_1",
        baseUrl: "https://app.test",
      });

      expect(result).toEqual({ url: "https://billing.stripe.com/portal" });
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: "cus_1",
        return_url: "https://app.test/settings/subscription",
      });
    });
  });
});
