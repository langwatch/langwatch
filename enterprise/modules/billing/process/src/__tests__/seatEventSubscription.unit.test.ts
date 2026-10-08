import { GrantExceedsCallerPermissionsError } from "@langwatch/authz-contract";
import {
  Currency,
  SubscriptionStatus,
  type StripePriceMap,
} from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../channels/memory/memory.stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import type {
  BillingInvoicePreview,
  BillingSubscription,
} from "../rules/billing-stripe-shapes.rules.ts";
import type { BillingLifecycleAnnouncerService } from "../services/billing-lifecycle-announcer.service.ts";
import {
  type SeatCheckoutInvites,
  SeatEventSubscriptionService,
} from "../services/seat-event-subscription.service.ts";
import { StripeCustomerCurrencyService } from "../services/stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../services/stripe-error-translator.service.ts";

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

/** A subscription as the provider holds it, with only the fields these paths read. */
const subscriptionOf = (fields: Partial<BillingSubscription>): BillingSubscription => ({
  id: "sub_stripe_1",
  status: "active",
  canceledAt: null,
  billingThreshold: null,
  items: [],
  ...fields,
});

/** An invoice preview as the provider computes it; decoy lines, subtotal and tax go unread. */
const previewOf = (
  preview: BillingInvoicePreview & { lines?: unknown; subtotal?: number; tax?: number },
): BillingInvoicePreview => preview;

const createMockSubscriptions = (): {
  [K in keyof SeatEventSubscriptionRepository]: Mock<SeatEventSubscriptionRepository[K]>;
} => ({
  findSeatCandidates: vi.fn().mockResolvedValue([]),
  cancelPendingSeatCheckouts: vi.fn().mockResolvedValue([]),
  createPendingSeatCheckout: vi.fn().mockResolvedValue({ id: "sub_new_1" }),
  reactivateWithSeats: vi.fn(),
});

const createMockInvites = (): {
  [K in keyof SeatCheckoutInvites]: Mock<SeatCheckoutInvites[K]>;
} => ({
  checkInvitesWithinCaller: vi.fn(),
  createPaymentPendingInvites: vi.fn(),
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("seatEventSubscription", () => {
  let stripeSubscriptions: MemoryStripeSubscriptionsChannel;
  let customers: MemoryStripeCustomersChannel;
  let subscriptions: ReturnType<typeof createMockSubscriptions>;
  let invites: ReturnType<typeof createMockInvites>;
  /** Billing's fact that organization drops the held invitations from (R42). */
  let abandoned: {
    seatCheckoutsAbandoned: Mock<BillingLifecycleAnnouncerService["seatCheckoutsAbandoned"]>;
  };
  let service: SeatEventSubscriptionService;

  beforeEach(() => {
    vi.clearAllMocks();
    stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
    customers = MemoryStripeCustomersChannel.create();
    // New customers have no fixed currency until their first subscription.
    customers.seed({ id: "cus_1", currency: null });
    subscriptions = createMockSubscriptions();
    invites = createMockInvites();
    abandoned = { seatCheckoutsAbandoned: vi.fn() };
    service = SeatEventSubscriptionService.create({
      stripeSubscriptions,
      subscriptions,
      invites,
      abandoned,
      prices,
      customerCurrency: StripeCustomerCurrencyService.create({
        customers,
        stripeErrors: StripeErrorTranslatorService.create(),
      }),
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
    id = "sub_stripe_1",
    canceledAt = null,
    interval = "month",
    unitAmount = 2500,
    priceId = "price_seat_usd_monthly",
  }: {
    id?: string;
    canceledAt?: number | null;
    interval?: string;
    unitAmount?: number | null;
    priceId?: string;
  } = {}) =>
    subscriptionOf({
      id,
      status: "active",
      canceledAt,
      items: [{ id: "si_seat", priceId, unitAmount, interval }],
    });

  describe("previewProration()", () => {
    describe("when active subscription exists with a seat item", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({ subscription: seatSubscription() });
      });

      it("returns formatted proration amount and recurring total for USD", async () => {
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 1500,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 1500,
          }),
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
        stripeSubscriptions.seed({
          subscription: seatSubscription({
            priceId: "price_seat_eur_monthly",
            unitAmount: 2000,
          }),
        });

        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "eur",
            total: 2000,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 2000,
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 5000,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 5000,
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 1450,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 1450,
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 4000,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 4000,
            lines: {
              data: [
                { proration: true, amount: 3000 },
                { proration: true, amount: 1000 },
              ],
            },
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            subtotal: 2458,
            tax: 516,
            total: 2974,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 2974,
            lines: {
              data: [
                { proration: true, amount: -4917 },
                { proration: true, amount: 7375 },
              ],
            },
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 140000,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 140000,
            lines: {
              has_more: true,
              data: [{ proration: true, amount: 10000 }],
            },
          }),
        });

        const result = await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(result.amountDueCents).toBe(140000);
      });

      /** @scenario "Reducing seats previews a credit rather than an amount owed" */
      it("reports a seat reduction as a signed credit", async () => {
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: -2500,
            // Stripe clamps a negative invoice here, which is exactly why the
            // credit case cannot read this field.
            amountDue: 0,
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "eur",
            total: 29370,
            amountDue: 9370,
          }),
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
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 0,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 0,
          }),
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 7,
        });

        // The Upcoming Invoice API rejects flexible-billing subscriptions
        // outright, so the preview must go through create_preview.
        expect(stripeSubscriptions.previews).toHaveLength(1);
        expect(stripeSubscriptions.previews).toEqual([
          {
            subscriptionId: "sub_stripe_1",
            change: {
              items: [{ id: "si_seat", quantity: 7 }],
              prorationBehavior: "always_invoice",
              prorationDate: expect.any(Number),
            },
          },
        ]);
      });
    });

    describe("when the seat price carries no per-seat amount", () => {
      it("refuses to quote rather than printing a zero recurring total", async () => {
        // Stripe reports `unit_amount: null` for tiered and metered prices.
        // Falling back to zero rendered "$0" as the new billing amount beside a
        // button that charges the card.
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({ subscription: seatSubscription({ unitAmount: null }) });
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 1500,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 1500,
          }),
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
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({
          subscription: seatSubscription({ canceledAt: 1700000000, interval: "year" }),
        });
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "eur",
            total: 63991,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 63991,
          }),
        });
      });

      it("previews the reactivation the update performs, not the cancellation", async () => {
        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 8,
        });

        // Without this, an annual plan billed next to a monthly meter is
        // quoted against a seat line truncated to the monthly boundary — the
        // same change quoted 54.25 and charged 639.91.
        expect(stripeSubscriptions.previews).toEqual([
          {
            subscriptionId: "sub_stripe_1",
            change: {
              cancelAtPeriodEnd: false,
              items: [{ id: "si_seat", quantity: 8 }],
              prorationBehavior: "always_invoice",
              prorationDate: expect.any(Number),
            },
          },
        ]);
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

        const previewed = stripeSubscriptions.previews[0]!.change;
        const applied = stripeSubscriptions.updates[0]!.change;

        expect(previewed).toEqual(applied);
      });
    });

    describe("when no subscription exists at all", () => {
      it("raises subscription_sync_failed", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);

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
        subscriptions.findSeatCandidates.mockResolvedValue([
          { id: "sub_db_1", stripeSubscriptionId: null, status: "ACTIVE" },
        ]);

        await expect(
          service.previewProration({
            organizationId: "org_1",
            newTotalSeats: 3,
          }),
        ).rejects.toMatchObject({ code: "subscription_not_linked" });
        expect(stripeSubscriptions.reads).toEqual([]);
      });

      /** @scenario "A cancelled subscription does not mask an unlinked active one" */
      it("is not masked by a cancelled subscription that kept its link", async () => {
        // `cancel()` keeps stripeSubscriptionId, so a churned subscription is a
        // permanent tombstone. Ranking by recency alone let it answer for an
        // organization whose live plan was never linked.
        subscriptions.findSeatCandidates.mockResolvedValue([
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
        expect(stripeSubscriptions.reads).toEqual([]);
      });
    });

    describe("when the organization has two active subscriptions", () => {
      /** @scenario "Two active subscriptions refuse a seat change rather than picking one" */
      it("refuses rather than charging whichever one still carries a link", async () => {
        // Reachable through the admin console subscription form, which writes any
        // status against any organization with no uniqueness check behind it.
        // Preferring the linked row would charge the older plan even when the
        // newer one was added to supersede it.
        subscriptions.findSeatCandidates.mockResolvedValue([
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
        expect(stripeSubscriptions.reads).toEqual([]);
      });

      /** @scenario "Two active subscriptions refuse a seat change rather than picking one" */
      it("refuses the update too, so nothing is charged", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([
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
        expect(stripeSubscriptions.updates).toEqual([]);
        expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
      });
    });

    describe("when a newer cancelled subscription sits above a live one", () => {
      /** @scenario "A live subscription outranks a more recent cancelled one" */
      it("acts on the live subscription", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([
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
        stripeSubscriptions.seed({ subscription: seatSubscription({ id: "sub_stripe_live" }) });
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 0,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 0,
          }),
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(stripeSubscriptions.reads).toEqual(["sub_stripe_live"]);
      });
    });

    describe("when only a cancelled subscription remains", () => {
      /** @scenario "Seat updates can reverse a scheduled cancellation" */
      it("acts on it, so a scheduled cancellation can be reversed", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([
          {
            id: "sub_db_1",
            stripeSubscriptionId: "sub_stripe_1",
            status: "CANCELLED",
          },
        ]);
        stripeSubscriptions.seed({ subscription: seatSubscription() });
        stripeSubscriptions.seedPreview({
          preview: previewOf({
            currency: "usd",
            total: 0,
            // Clean account: nothing to draw down, so the card is charged the total.
            amountDue: 0,
          }),
        });

        await service.previewProration({
          organizationId: "org_1",
          newTotalSeats: 3,
        });

        expect(stripeSubscriptions.reads).toEqual(["sub_stripe_1"]);
      });
    });

    describe("when Stripe subscription is not active", () => {
      it("raises subscription_sync_failed", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({
          subscription: subscriptionOf({
            id: "sub_stripe_1",
            status: "canceled",
            items: [],
          }),
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
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({
          subscription: subscriptionOf({
            id: "sub_stripe_1",
            status: "active",
            items: [
              {
                id: "si_events",
                priceId: "price_events_usd_monthly",
                unitAmount: null,
                interval: null,
              },
            ],
          }),
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
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({ subscription: seatSubscription() });
      });

      it("updates Stripe subscription seat quantity", async () => {
        const result = await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
        });

        expect(result).toEqual({ success: true });
        expect(stripeSubscriptions.updates).toEqual([
          {
            subscriptionId: "sub_stripe_1",
            change: {
              items: [{ id: "si_seat", quantity: 10 }],
              prorationBehavior: "always_invoice",
              prorationDate: expect.any(Number),
            },
          },
        ]);
      });

      /** @scenario "The charge prices the same instant the quote did" */
      it("charges at the instant the quote priced, not at confirm time", async () => {
        const quotedAt = Math.floor(Date.now() / 1000) - 120;

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
          quotedAt,
        });

        expect(stripeSubscriptions.updates).toEqual([
          {
            subscriptionId: "sub_stripe_1",
            change: expect.objectContaining({ prorationDate: quotedAt }),
          },
        ]);
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
        expect(stripeSubscriptions.updates).toEqual([]);
        expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
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
        expect(stripeSubscriptions.updates).toEqual([]);
      });

      it("prices at now when no quote was shown", async () => {
        const before = Math.floor(Date.now() / 1000);

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 10,
        });

        const change = stripeSubscriptions.updates[0]!.change;
        expect(change.prorationDate).toBeGreaterThanOrEqual(before);
      });

      it("updates DB subscription to ACTIVE with new seat count", async () => {
        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 8,
        });

        expect(subscriptions.reactivateWithSeats).toHaveBeenCalledWith({
          id: "sub_db_1",
          maxMembers: 8,
        });
      });
    });

    describe("when subscription is scheduled for cancellation", () => {
      it("reactivates by setting cancel_at_period_end to false", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({ subscription: seatSubscription({ canceledAt: 1700000000 }) });

        await service.updateSeatEventItems({
          organizationId: "org_1",
          totalMembers: 5,
        });

        expect(stripeSubscriptions.updates).toEqual([
          {
            subscriptionId: "sub_stripe_1",
            change: {
              cancelAtPeriodEnd: false,
              items: [{ id: "si_seat", quantity: 5 }],
              prorationBehavior: "always_invoice",
              prorationDate: expect.any(Number),
            },
          },
        ]);
      });
    });

    describe("when no subscription exists at all", () => {
      /** @scenario "A seat update that cannot proceed fails instead of resolving quietly" */
      it("raises subscription_sync_failed instead of resolving as a silent no-op", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
        expect(stripeSubscriptions.reads).toEqual([]);
      });
    });

    describe("when the active subscription has no billing-provider link", () => {
      /** @scenario "An unlinked subscription blocks the seat update itself" */
      it("raises subscription_not_linked so the seat update cannot pass as a success", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([
          { id: "sub_db_1", stripeSubscriptionId: null, status: "ACTIVE" },
        ]);

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_not_linked" });
        expect(stripeSubscriptions.reads).toEqual([]);
        expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
      });
    });

    describe("when Stripe subscription status is not active", () => {
      it("raises subscription_sync_failed", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({
          subscription: subscriptionOf({
            id: "sub_stripe_1",
            status: "canceled",
            items: [],
          }),
        });

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
        expect(stripeSubscriptions.updates).toEqual([]);
      });
    });

    describe("when no seat item found on Stripe subscription", () => {
      it("raises subscription_sync_failed for the missing seat item", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([linkedActive]);
        stripeSubscriptions.seed({
          subscription: subscriptionOf({
            id: "sub_stripe_1",
            status: "active",
            items: [
              {
                id: "si_events",
                priceId: "price_events_usd_monthly",
                unitAmount: null,
                interval: null,
              },
            ],
          }),
        });

        await expect(
          service.updateSeatEventItems({
            organizationId: "org_1",
            totalMembers: 5,
          }),
        ).rejects.toMatchObject({ code: "subscription_sync_failed" });
        expect(stripeSubscriptions.updates).toEqual([]);
      });
    });
  });

  // ── createSeatEventCheckout ───────────────────────────────────────────────

  describe("createSeatEventCheckout()", () => {
    describe("when stale PENDING subscriptions exist", () => {
      beforeEach(() => {
        subscriptions.cancelPendingSeatCheckouts.mockResolvedValue(["stale_sub_1", "stale_sub_2"]);
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

        expect(subscriptions.cancelPendingSeatCheckouts).toHaveBeenCalledWith({
          organizationId: "org_1",
        });
      });

      it("records the stale subs as abandoned, so organization drops their PAYMENT_PENDING invites", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 3,
        });

        expect(abandoned.seatCheckoutsAbandoned).toHaveBeenCalledWith({
          organizationId: "org_1",
          subscriptionIds: ["stale_sub_1", "stale_sub_2"],
        });
      });
    });

    describe("when the checkout carries invitations", () => {
      beforeEach(() => {});

      /** @scenario Inviting through a seat checkout is bounded by the inviter */
      it("holds them as the person who invited, so organization bounds them by that person", async () => {
        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: Currency.USD,
          billingInterval: "monthly",
          membersToAdd: 1,
          invitations: {
            invites: [{ email: "bo@acme.test", role: "ADMIN", teamIds: "team_1" }],
            by: { id: "user_1" },
          },
        });

        expect(invites.createPaymentPendingInvites).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org_1",
            invites: [{ email: "bo@acme.test", role: "ADMIN", teamIds: "team_1" }],
          }),
          { id: "user_1" },
        );
      });

      /** @scenario A seat checkout inviting past the inviter writes nothing */
      it("refuses invitations past the inviter before any checkout row is written", async () => {
        invites.checkInvitesWithinCaller.mockRejectedValue(
          new GrantExceedsCallerPermissionsError(["organization:manage"]),
        );

        await expect(
          service.createSeatEventCheckout({
            organizationId: "org_1",
            customerId: "cus_1",
            baseUrl: "https://app.test",
            currency: Currency.USD,
            billingInterval: "monthly",
            membersToAdd: 1,
            invitations: {
              invites: [{ email: "bo@acme.test", role: "ADMIN", teamIds: "team_1" }],
              by: { id: "user_1" },
            },
          }),
        ).rejects.toMatchObject({
          code: "grant_exceeds_caller_permissions",
          meta: { missingPermissions: ["organization:manage"] },
        });

        expect(invites.checkInvitesWithinCaller).toHaveBeenCalledWith(
          {
            organizationId: "org_1",
            invites: [{ email: "bo@acme.test", role: "ADMIN", teamIds: "team_1" }],
          },
          { id: "user_1" },
        );
        expect(subscriptions.cancelPendingSeatCheckouts).not.toHaveBeenCalled();
        expect(subscriptions.createPendingSeatCheckout).not.toHaveBeenCalled();
        expect(invites.createPaymentPendingInvites).not.toHaveBeenCalled();
        expect(stripeSubscriptions.checkoutSessions).toEqual([]);
      });
    });

    describe("when no stale subscriptions exist", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
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

        expect(abandoned.seatCheckoutsAbandoned).not.toHaveBeenCalled();
      });
    });

    describe("when creating checkout session", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
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
          url: "https://checkout.memory.test/cs_memory_1",
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

        expect(stripeSubscriptions.checkoutSessions[0]?.request).toEqual(
          expect.objectContaining({
            customerId: "cus_1",
            lineItems: [
              { price: "price_seat_usd_monthly", quantity: 3 },
              { price: "price_events_usd_monthly" },
            ],
            metadata: {
              selectedCurrency: "USD",
              selectedBillingInterval: "monthly",
            },
            clientReferenceId: "subscription_setup_sub_new_1",
            allowPromotionCodes: true,
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

        const callArgs = stripeSubscriptions.checkoutSessions[0]!.request;
        expect(callArgs.successUrl).toBe("https://app.test/settings/subscription?success");
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

        const callArgs = stripeSubscriptions.checkoutSessions[0]!.request;
        expect(callArgs.successUrl).toBe(
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

        const callArgs = stripeSubscriptions.checkoutSessions[0]!.request;
        const anchor = callArgs.subscription?.billingCycleAnchor as number;

        // Anchor should be a Unix timestamp for the 1st of next month
        const anchorDate = new Date(anchor * 1000);
        expect(anchorDate.getUTCDate()).toBe(1);
      });
    });

    describe("when the Stripe customer already has a fixed currency", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.seed({
          id: "cus_1",
          currency: "eur",
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

        expect(stripeSubscriptions.checkoutSessions[0]?.request).toEqual(
          expect.objectContaining({
            currency: "eur",
            lineItems: [
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

        expect(stripeSubscriptions.checkoutSessions[0]?.request).toEqual(
          expect.objectContaining({ currency: "eur" }),
        );
      });
    });

    describe("when the provider rate-limits the currency lookup", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.refuse({
          operation: "getCustomer",
          error: new Stripe.errors.StripeRateLimitError({
            message: "slow down",
            type: "rate_limit_error",
          }),
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

        expect(stripeSubscriptions.checkoutSessions).toEqual([]);
        expect(subscriptions.createPendingSeatCheckout).not.toHaveBeenCalled();
        expect(subscriptions.cancelPendingSeatCheckouts).not.toHaveBeenCalled();
        expect(abandoned.seatCheckoutsAbandoned).not.toHaveBeenCalled();
      });
    });

    describe("when the provider is unreachable during the currency lookup", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.refuse({
          operation: "getCustomer",
          error: new Stripe.errors.StripeConnectionError({
            message: "network down",
            type: "api_error",
          }),
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
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.refuse({ operation: "getCustomer", error: lookupError });
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

        expect(stripeSubscriptions.checkoutSessions).toEqual([]);
        expect(subscriptions.createPendingSeatCheckout).not.toHaveBeenCalled();
        expect(subscriptions.cancelPendingSeatCheckouts).not.toHaveBeenCalled();
        expect(abandoned.seatCheckoutsAbandoned).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer is fixed to a currency we do not sell in", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.seed({
          id: "cus_1",
          currency: "gbp",
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

        expect(stripeSubscriptions.checkoutSessions).toEqual([]);
        expect(subscriptions.createPendingSeatCheckout).not.toHaveBeenCalled();
        expect(subscriptions.cancelPendingSeatCheckouts).not.toHaveBeenCalled();
        expect(abandoned.seatCheckoutsAbandoned).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer has been deleted", () => {
      beforeEach(() => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.seed({
          id: "cus_1",
          deleted: true,
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

        expect(stripeSubscriptions.checkoutSessions).toEqual([]);
        expect(subscriptions.createPendingSeatCheckout).not.toHaveBeenCalled();
        expect(subscriptions.cancelPendingSeatCheckouts).not.toHaveBeenCalled();
        expect(abandoned.seatCheckoutsAbandoned).not.toHaveBeenCalled();
      });
    });

    describe("when the Stripe customer has no currency yet", () => {
      it("uses the requested currency, since nothing is fixed", async () => {
        subscriptions.findSeatCandidates.mockResolvedValue([]);
        customers.seed({
          id: "cus_1",
          currency: null,
        });

        await service.createSeatEventCheckout({
          organizationId: "org_1",
          customerId: "cus_1",
          baseUrl: "https://app.test",
          currency: "USD" as any,
          billingInterval: "monthly",
          membersToAdd: 2,
        });

        expect(stripeSubscriptions.checkoutSessions[0]?.request).toEqual(
          expect.objectContaining({ currency: "usd" }),
        );
      });
    });
  });

  // ── seatEventBillingPortalUrl ─────────────────────────────────────────────

  describe("seatEventBillingPortalUrl()", () => {
    it("creates portal session and returns URL", async () => {
      const result = await service.seatEventBillingPortalUrl({
        customerId: "cus_1",
        baseUrl: "https://app.test",
      });

      expect(result).toEqual({ url: "https://billing.memory.test/bps_memory_1" });
      expect(stripeSubscriptions.portalSessions).toEqual([
        {
          customerId: "cus_1",
          returnUrl: "https://app.test/settings/subscription",
          url: "https://billing.memory.test/bps_memory_1",
        },
      ]);
    });
  });
});
