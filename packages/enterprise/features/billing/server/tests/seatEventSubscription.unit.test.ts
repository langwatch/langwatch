import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SubscriptionStatus,
  type StripePriceMap,
} from "@langwatch/enterprise-billing-contract";
import {
  SeatEventSubscriptionService,
  StripeCustomerCurrencyService,
  StripeErrorAdapter,
} from "../src/index";

const prices = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
} as StripePriceMap;

// ── Mock factories ──────────────────────────────────────────────────────────

const createMockStripe = () => ({
  customers: {
    // New customers have no fixed currency until their first subscription
    retrieve: vi.fn().mockResolvedValue({ id: "cus_1", currency: null }),
  },
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
    createPreview: vi.fn(),
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
  let service: SeatEventSubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = createMockStripe();
    db = createMockDb();
    service = SeatEventSubscriptionService.create({
      stripe: stripe as any,
      database: db as any,
      prices,
      customerCurrency: StripeCustomerCurrencyService.create(StripeErrorAdapter.create()),
    });
  });

  // ── previewProration ────────────────────────────────────────────────────

  /** An ACTIVE, linked row — the ordinary case. */
  const linkedActive = {
    id: "sub_db_1",
    stripeSubscriptionId: "sub_stripe_1",
    status: SubscriptionStatus.ACTIVE,
  };

  const seatSubscription = ({
    canceledAt = null,
    interval = "month",
    unitAmount = 2500,
    priceId = "price_seat_usd_monthly",
  }: {
    canceledAt?: number | null;
    interval?: string;
    unitAmount?: number | null;
    priceId?: string;
  } = {}) => ({
    status: "active",
    canceled_at: canceledAt,
    items: {
      data: [
        {
          id: "si_seat",
          price: {
            id: priceId,
            unit_amount: unitAmount,
            recurring: { interval },
          },
        },
      ],
    },
  });

  describe("previewProration()", () => {
    describe("when active subscription exists with a seat item", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue(seatSubscription());
      });

      it("returns formatted proration amount and recurring total for USD", async () => {
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 1500,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 1500,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 4,
        });

        // Only the proration line counts; the recurring line is next cycle.
        expect(result.formattedAmountDue).toBe("$15");
        expect(result.amountDueCents).toBe(1500);
        // 4 seats * $25 = $100 (whole number, no decimals)
        expect(result.formattedRecurringTotal).toBe("$100");
        expect(result.billingInterval).toBe("month");
      });

      it("returns formatted proration amount and recurring total for EUR", async () => {
        stripe.subscriptions.retrieve.mockResolvedValue(
          seatSubscription({
            priceId: "price_seat_eur_monthly",
            unitAmount: 2000,
          }),
        );

        stripe.invoices.createPreview.mockResolvedValue({
          currency: "eur",
          total: 2000,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 2000,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 5,
        });

        // EUR uses en-IE locale
        expect(result.formattedAmountDue).toBe("€20");
        expect(result.formattedRecurringTotal).toBe("€100");
      });

      it("formats whole amounts without decimals", async () => {
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 5000,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 5000,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 2,
        });

        expect(result.formattedAmountDue).toBe("$50");
        // 2 * 2500 = 5000 cents = $50
        expect(result.formattedRecurringTotal).toBe("$50");
      });

      it("formats fractional amounts with two decimal places", async () => {
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 1450,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 1450,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 1,
        });

        expect(result.formattedAmountDue).toBe("$14.50");
      });

      /** @scenario "Amount due counts prorations the subscription already carried" */
      it("quotes the whole previewed invoice, including prorations already pending", async () => {
        // A mid-cycle billing anchor leaves pending prorations on the
        // subscription. `always_invoice` charges them alongside the seat
        // change, so anything less than the invoice total under-quotes what
        // the card is debited.
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 4000,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 4000,
          lines: {
            data: [
              { proration: true, amount: 3000 },
              { proration: true, amount: 1000 },
            ],
          },
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(result.amountDueCents).toBe(4000);
      });

      /** @scenario "Amount due includes tax where the currency is taxed on top" */
      it("quotes the taxed total, not the pre-tax line amounts", async () => {
        // Line amounts are pre-tax. Where tax is exclusive (USD here), summing
        // them quoted a fifth under what the card is debited.
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          subtotal: 2458,
          tax: 516,
          total: 2974,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 2974,
          lines: {
            data: [
              { proration: true, amount: -4917 },
              { proration: true, amount: 7375 },
            ],
          },
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(result.amountDueCents).toBe(2974);
        expect(result.formattedAmountDue).toBe("$29.74");
      });

      /** @scenario "Amount due survives an invoice whose lines span more than one page" */
      it("quotes the whole invoice even when its lines are paginated", async () => {
        // `lines` is a paginated sublist, so a subscription carrying enough
        // pending prorations silently dropped everything past the first page.
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 140000,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 140000,
          lines: {
            has_more: true,
            data: [{ proration: true, amount: 10000 }],
          },
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(result.amountDueCents).toBe(140000);
      });

      /** @scenario "Reducing seats previews a credit rather than an amount owed" */
      it("reports a seat reduction as a signed credit", async () => {
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: -2500,
          // Stripe clamps a negative invoice here, which is exactly why the
          // credit case cannot read this field.
          amount_due: 0,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 1,
        });

        expect(result.amountDueCents).toBe(-2500);
        expect(result.formattedCreditApplied).toBeNull();
      });

      /** @scenario "Due today is the amount the card is charged, not the invoice total" */
      it("quotes the amount charged when the account is holding credit", async () => {
        // Measured against the provider on one purchase, two accounts: the
        // invoice is 293.70 either way, but an account holding 200.00 of
        // credit is charged 93.70.
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "eur",
          total: 29370,
          amount_due: 9370,
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 6,
        });

        expect(result.amountDueCents).toBe(9370);
        expect(result.formattedCreditApplied).toBe("€200");
      });

      /** @scenario "Preview works for subscriptions on flexible billing" */
      it("previews the seat change through the Create Preview Invoice API, in one call", async () => {
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 0,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 0,
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 7,
        });

        // The Upcoming Invoice API rejects flexible-billing subscriptions
        // outright, so the preview must go through create_preview.
        expect(stripe.invoices.createPreview).toHaveBeenCalledTimes(1);
        expect(stripe.invoices.createPreview).toHaveBeenCalledWith({
          subscription: "sub_stripe_1",
          subscription_details: {
            items: [{ id: "si_seat", quantity: 7 }],
            proration_behavior: "always_invoice",
            proration_date: expect.any(Number),
          },
        });
      });
    });

    describe("when the seat price carries no per-seat amount", () => {
      it("refuses to quote rather than printing a zero recurring total", async () => {
        // Stripe reports `unit_amount: null` for tiered and metered prices.
        // Falling back to zero rendered "$0" as the new billing amount beside a
        // button that charges the card.
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue(
          seatSubscription({ unitAmount: null }),
        );
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 1500,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 1500,
        });

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 4,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });

    describe("when the subscription is scheduled for cancellation", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue(
          seatSubscription({ canceledAt: 1700000000, interval: "year" }),
        );
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "eur",
          total: 63991,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 63991,
        });
        stripe.subscriptions.update.mockResolvedValue({});
      });

      it("previews the reactivation the update performs, not the cancellation", async () => {
        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 8,
        });

        // Without this, an annual plan billed next to a monthly meter is
        // quoted against a seat line truncated to the monthly boundary — the
        // same change quoted 54.25 and charged 639.91.
        expect(stripe.invoices.createPreview).toHaveBeenCalledWith({
          subscription: "sub_stripe_1",
          subscription_details: {
            cancel_at_period_end: false,
            items: [{ id: "si_seat", quantity: 8 }],
            proration_behavior: "always_invoice",
            proration_date: expect.any(Number),
          },
        });
      });

      /** @scenario "Preview quotes the same change the confirmation applies" */
      it("quotes the same change the update applies", async () => {
        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 8,
        });
        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 8,
        });

        const previewed =
          stripe.invoices.createPreview.mock.calls[0]![0].subscription_details;
        const applied = stripe.subscriptions.update.mock.calls[0]![1];

        expect(previewed).toEqual(applied);
      });
    });

    describe("when no subscription exists at all", () => {
      it("raises subscription_sync_failed", async () => {
        db.subscription.findMany.mockResolvedValue([]);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });

    describe("when the active subscription has no billing-provider link", () => {
      /** @scenario "An active subscription with no billing-provider link is named as such" */
      it("raises subscription_not_linked instead of the retryable sync error", async () => {
        db.subscription.findMany.mockResolvedValue([
          { id: "sub_db_1", stripeSubscriptionId: null, status: "ACTIVE" },
        ]);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_not_linked" });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      });

      /** @scenario "A cancelled subscription does not mask an unlinked active one" */
      it("is not masked by a cancelled subscription that kept its link", async () => {
        // `cancel()` keeps stripeSubscriptionId, so a churned subscription is a
        // permanent tombstone. Ranking by recency alone let it answer for an
        // organization whose live plan was never linked.
        db.subscription.findMany.mockResolvedValue([
          {
            id: "sub_db_tombstone",
            stripeSubscriptionId: "sub_stripe_dead",
            status: "CANCELLED",
          },
          { id: "sub_db_live", stripeSubscriptionId: null, status: "ACTIVE" },
        ]);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_not_linked" });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      });
    });

    describe("when the organization has two active subscriptions", () => {
      /** @scenario "Two active subscriptions refuse a seat change rather than picking one" */
      it("refuses rather than charging whichever one still carries a link", async () => {
        // Reachable through the backoffice subscription form, which writes any
        // status against any organization with no uniqueness check behind it.
        // Preferring the linked row would charge the older plan even when the
        // newer one was added to supersede it.
        db.subscription.findMany.mockResolvedValue([
          { id: "sub_db_new", stripeSubscriptionId: null, status: "ACTIVE" },
          {
            id: "sub_db_old",
            stripeSubscriptionId: "sub_stripe_old",
            status: "ACTIVE",
          },
        ]);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_ambiguous" });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      });

      /** @scenario "Two active subscriptions refuse a seat change rather than picking one" */
      it("refuses the update too, so nothing is charged", async () => {
        db.subscription.findMany.mockResolvedValue([
          {
            id: "sub_db_a",
            stripeSubscriptionId: "sub_stripe_a",
            status: "ACTIVE",
          },
          {
            id: "sub_db_b",
            stripeSubscriptionId: "sub_stripe_b",
            status: "ACTIVE",
          },
        ]);

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_ambiguous" });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when a newer cancelled subscription sits above a live one", () => {
      /** @scenario "A live subscription outranks a more recent cancelled one" */
      it("acts on the live subscription", async () => {
        db.subscription.findMany.mockResolvedValue([
          {
            id: "sub_db_new",
            stripeSubscriptionId: "sub_stripe_dead",
            status: "CANCELLED",
          },
          {
            id: "sub_db_old",
            stripeSubscriptionId: "sub_stripe_live",
            status: "ACTIVE",
          },
        ]);
        stripe.subscriptions.retrieve.mockResolvedValue(seatSubscription());
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 0,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 0,
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_stripe_live");
      });
    });

    describe("when only a cancelled subscription remains", () => {
      /** @scenario "Seat updates can reverse a scheduled cancellation" */
      it("acts on it, so a scheduled cancellation can be reversed", async () => {
        db.subscription.findMany.mockResolvedValue([
          {
            id: "sub_db_1",
            stripeSubscriptionId: "sub_stripe_1",
            status: "CANCELLED",
          },
        ]);
        stripe.subscriptions.retrieve.mockResolvedValue(seatSubscription());
        stripe.invoices.createPreview.mockResolvedValue({
          currency: "usd",
          total: 0,
          // Clean account: nothing to draw down, so the card is charged the total.
          amount_due: 0,
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_stripe_1");
      });
    });

    describe("when Stripe subscription is not active", () => {
      it("raises subscription_sync_failed", async () => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "canceled",
          items: { data: [] },
        });

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });

    describe("when no seat item found on subscription", () => {
      it("raises subscription_sync_failed for a missing seat item", async () => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [{ id: "si_events", price: { id: "price_events_usd_monthly" } }],
          },
        });

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
      });
    });
  });

  // ── updateSeatEventItems ──────────────────────────────────────────────────

  describe("updateSeatEventItems()", () => {
    describe("when active subscription exists with a seat item", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue(seatSubscription());
        stripe.subscriptions.update.mockResolvedValue({});
      });

      it("updates Stripe subscription seat quantity", async () => {
        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
        });

        expect(result).toEqual({ success: true });
        expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
          items: [{ id: "si_seat", quantity: 10 }],
          proration_behavior: "always_invoice",
          proration_date: expect.any(Number),
        });
      });

      /** @scenario "The charge prices the same instant the quote did" */
      it("charges at the instant the quote priced, not at confirm time", async () => {
        const quotedAt = Math.floor(Date.now() / 1000) - 120;

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
          quotedAt,
        });

        expect(stripe.subscriptions.update).toHaveBeenCalledWith(
          "sub_stripe_1",
          expect.objectContaining({ proration_date: quotedAt }),
        );
      });

      /** @scenario "A quote too old to honour is refused rather than repriced" */
      it("refuses a quote older than the window, before touching the provider", async () => {
        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 10,
            quotedAt: Math.floor(Date.now() / 1000) - 16 * 60,
          }),
        ).rejects.toMatchObject({ code: "billing_quote_expired" });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
        expect(db.subscription.update).not.toHaveBeenCalled();
      });

      /** @scenario "A quote too old to honour is refused rather than repriced" */
      it("refuses a quote dated in the future, which none we issued can be", async () => {
        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 10,
            quotedAt: Math.floor(Date.now() / 1000) + 300,
          }),
        ).rejects.toMatchObject({ code: "billing_quote_expired" });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      });

      it("prices at now when no quote was shown", async () => {
        const before = Math.floor(Date.now() / 1000);

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
        });

        const params = stripe.subscriptions.update.mock.calls[0]![1];
        expect(params.proration_date).toBeGreaterThanOrEqual(before);
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
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue(
          seatSubscription({ canceledAt: 1700000000 }),
        );
        stripe.subscriptions.update.mockResolvedValue({});

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", {
          cancel_at_period_end: false,
          items: [{ id: "si_seat", quantity: 5 }],
          proration_behavior: "always_invoice",
          proration_date: expect.any(Number),
        });
      });
    });

    describe("when no subscription exists at all", () => {
      /** @scenario "A seat update that cannot proceed fails instead of resolving quietly" */
      it("raises subscription_sync_failed instead of resolving as a silent no-op", async () => {
        db.subscription.findMany.mockResolvedValue([]);

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      });
    });

    describe("when the active subscription has no billing-provider link", () => {
      /** @scenario "An unlinked subscription blocks the seat update itself" */
      it("raises subscription_not_linked so the seat update cannot pass as a success", async () => {
        db.subscription.findMany.mockResolvedValue([
          { id: "sub_db_1", stripeSubscriptionId: null, status: "ACTIVE" },
        ]);

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_not_linked" });
        expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(db.subscription.update).not.toHaveBeenCalled();
      });
    });

    describe("when Stripe subscription status is not active", () => {
      it("raises subscription_sync_failed", async () => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "canceled",
          items: { data: [] },
        });

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
        expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      });
    });

    describe("when no seat item found on Stripe subscription", () => {
      it("raises subscription_sync_failed for the missing seat item", async () => {
        db.subscription.findMany.mockResolvedValue([linkedActive]);
        stripe.subscriptions.retrieve.mockResolvedValue({
          status: "active",
          items: {
            data: [{ id: "si_events", price: { id: "price_events_usd_monthly" } }],
          },
        });

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
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
        const anchor = callArgs.subscription_data.billing_cycle_anchor as number;

        // Anchor should be a Unix timestamp for the 1st of next month
        const anchorDate = new Date(anchor * 1000);
        expect(anchorDate.getUTCDate()).toBe(1);
      });
    });

    describe("when the Stripe customer already has a fixed currency", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockResolvedValue({
          id: "cus_1",
          currency: "eur",
        });
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("builds the checkout in the customer currency, not the requested one", async () => {
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
            currency: "eur",
            line_items: [
              { price: "price_seat_eur_monthly", quantity: 3 },
              { price: "price_events_eur_monthly" },
            ],
            metadata: {
              selectedCurrency: "EUR",
              selectedBillingInterval: "monthly",
            },
          }),
        );
      });

      it("keeps the requested currency when it matches the customer currency", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "EUR" as any,
          billingInterval: "monthly",
          membersToAdd: 2,
        });

        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({ currency: "eur" }),
        );
      });
    });

    describe("when the provider rate-limits the currency lookup", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockRejectedValue(
          new Stripe.errors.StripeRateLimitError({
            message: "slow down",
            type: "rate_limit_error",
          }),
        );
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("fails with a retryable provider-unavailable error", async () => {
        await expect(
          service.createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          }),
        ).rejects.toMatchObject({ code: "billing_provider_unavailable" });
      });

      it("creates no checkout session and no pending records", async () => {
        await service
          .createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          })
          .catch(() => undefined);

        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.subscription.updateMany).not.toHaveBeenCalled();
        expect(db.organizationInvite.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the provider is unreachable during the currency lookup", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockRejectedValue(
          new Stripe.errors.StripeConnectionError({
            message: "network down",
            type: "api_error",
          }),
        );
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("fails with the same retryable provider-unavailable error", async () => {
        await expect(
          service.createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          }),
        ).rejects.toMatchObject({ code: "billing_provider_unavailable" });
      });
    });

    describe("when the currency lookup fails for a reason we cannot name", () => {
      const lookupError = new Error("socket hang up");

      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockRejectedValue(lookupError);
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("lets the original error through instead of dressing it as handled", async () => {
        const error = await service
          .createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          })
          .catch((caught: unknown) => caught);

        // Identity, not just the message: "returned untouched" is the contract,
        // and a same-message replacement would satisfy a message check.
        expect(error).toBe(lookupError);
        expect(error).not.toHaveProperty("isHandled");
      });

      it("still creates no checkout session and no pending records", async () => {
        await service
          .createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          })
          .catch(() => undefined);

        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.subscription.updateMany).not.toHaveBeenCalled();
        expect(db.organizationInvite.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer is fixed to a currency we do not sell in", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockResolvedValue({
          id: "cus_1",
          currency: "gbp",
        });
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("fails with an unsupported-billing-currency error", async () => {
        await expect(
          service.createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          }),
        ).rejects.toMatchObject({ code: "billing_currency_unsupported" });
      });

      it("creates no checkout session and no pending records", async () => {
        await service
          .createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          })
          .catch(() => undefined);

        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.subscription.updateMany).not.toHaveBeenCalled();
        expect(db.organizationInvite.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer has been deleted", () => {
      beforeEach(() => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockResolvedValue({
          id: "cus_1",
          deleted: true,
        });
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });
      });

      it("fails with a deleted-billing-customer error", async () => {
        await expect(
          service.createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          }),
        ).rejects.toMatchObject({ code: "billing_customer_deleted" });
      });

      it("creates no checkout session and no pending records", async () => {
        await service
          .createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: "USD" as any,
            billingInterval: "monthly",
            membersToAdd: 2,
          })
          .catch(() => undefined);

        expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
        expect(db.subscription.updateMany).not.toHaveBeenCalled();
        expect(db.organizationInvite.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer has no currency yet", () => {
      it("uses the requested currency, since nothing is fixed", async () => {
        db.subscription.findMany.mockResolvedValue([]);
        stripe.customers.retrieve.mockResolvedValue({
          id: "cus_1",
          currency: null,
        });
        stripe.checkout.sessions.create.mockResolvedValue({
          url: "https://checkout.stripe.com/session",
        });

        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 2,
        });

        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
          expect.objectContaining({ currency: "usd" }),
        );
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
