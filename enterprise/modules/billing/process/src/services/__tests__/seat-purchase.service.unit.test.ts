/**
 * @vitest-environment node
 * One full seat bought for a role change: charged now, held for the customer, or bought at
 * checkout.
 * @see ../../../../../../../specs/licensing/role-change-seat.feature
 */
import { type StripePriceMap, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeInvoicesChannel } from "../../channels/memory/memory.stripe-invoices.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../../repositories/seat-event-subscription.repository.ts";
import type { BillingSubscription } from "../../rules/billing-stripe-shapes.rules.ts";
import { SEAT_INVOICE_LIFETIME_SECONDS } from "../../rules/seat-invoice.rules.ts";
import { SeatEventSubscriptionService } from "../seat-event-subscription.service.ts";
import { SeatPurchaseService, type SeatCheckoutOpener } from "../seat-purchase.service.ts";
import { StripeCustomerCurrencyService } from "../stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../stripe-error-translator.service.ts";

const ORG = "org_acme";
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
/** 14 Dec 2099, when the next period starts. */
const PERIOD_END_SECONDS = Math.floor(Date.UTC(2099, 11, 14) / 1000);
const nowSeconds = () => Math.floor(nowInstant().epochMilliseconds / 1000);
const NO_KEPT = { seatsKept: null, seatsKeptUntil: null };
const linkedActive = {
  id: "sub_db_1",
  stripeSubscriptionId: "sub_stripe_1",
  status: SubscriptionStatus.ACTIVE,
  maxMembers: 2,
  ...NO_KEPT,
};
const START = { baseUrl: "https://app.example", successPath: "/back", customerEmail: null };

const seatSubscription = (quantity: number, id = "sub_stripe_1"): BillingSubscription => ({
  id,
  customerId: "cus_acme",
  status: "active",
  canceledAt: null,
  billingThreshold: null,
  currentPeriodEnd: PERIOD_END_SECONDS,
  items: [
    {
      id: "si_seat",
      priceId: "price_seat_usd_monthly",
      unitAmount: 3400,
      interval: "month",
      quantity,
      createdAt: 1_700_000_000,
    },
  ],
});

/** Only what a purchase and its settlement read and write; any other call throws by name. */
const repository = () => {
  const configured = {
    findSeatCandidates: vi.fn<SeatEventSubscriptionRepository["findSeatCandidates"]>(async () => [
      linkedActive,
    ]),
    findActivePlans: vi.fn<SeatEventSubscriptionRepository["findActivePlans"]>(async () => []),
    supersedeStrayRows: vi.fn<SeatEventSubscriptionRepository["supersedeStrayRows"]>(
      async () => undefined,
    ),
    cancelPendingSeatCheckouts: vi.fn<
      SeatEventSubscriptionRepository["cancelPendingSeatCheckouts"]
    >(async () => []),
    createPendingSeatCheckout: vi.fn<SeatEventSubscriptionRepository["createPendingSeatCheckout"]>(
      async () => ({ id: "sub_new_1" }),
    ),
    reactivateWithSeats: vi.fn<SeatEventSubscriptionRepository["reactivateWithSeats"]>(
      async () => undefined,
    ),
    isSeatRepairPending: vi.fn<SeatEventSubscriptionRepository["isSeatRepairPending"]>(
      async () => false,
    ),
    claimSeatLine: vi.fn<SeatEventSubscriptionRepository["claimSeatLine"]>(async () => ({
      claimed: true,
      token: "lease_1",
    })),
    renewSeatLine: vi.fn<SeatEventSubscriptionRepository["renewSeatLine"]>(async () => true),
    beginSeatLineWrite: vi.fn<SeatEventSubscriptionRepository["beginSeatLineWrite"]>(async () => ({
      held: true,
      opened: null,
    })),
    finishSeatLineWrite: vi.fn<SeatEventSubscriptionRepository["finishSeatLineWrite"]>(
      async () => true,
    ),
    findSeatLineTarget: vi.fn<SeatEventSubscriptionRepository["findSeatLineTarget"]>(async () => ({
      quantity: null,
      at: null,
    })),
    releaseSeatLine: vi.fn<SeatEventSubscriptionRepository["releaseSeatLine"]>(
      async () => undefined,
    ),
  };
  return Object.assign(
    createApiFixture<SeatEventSubscriptionRepository>(configured, "subscriptions"),
    configured,
  );
};

describe("SeatPurchaseService", () => {
  let stripeSubscriptions: MemoryStripeSubscriptionsChannel;
  let stripeInvoices: MemoryStripeInvoicesChannel;
  let subscriptions: ReturnType<typeof repository>;
  let duplicates: { reportDuplicateActive: Mock };
  let openCheckout: Mock<SeatCheckoutOpener>;
  let pricingModel: string | null;
  let service: SeatPurchaseService;

  beforeEach(() => {
    stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
    stripeSubscriptions.seed({ subscription: seatSubscription(2) });
    stripeSubscriptions.seedPreview({
      preview: { currency: "usd", total: 519, amountDue: 519 },
    });
    stripeInvoices = MemoryStripeInvoicesChannel.create();
    const customers = MemoryStripeCustomersChannel.create();
    customers.seed({ id: "cus_acme", currency: "usd" });
    subscriptions = repository();
    duplicates = { reportDuplicateActive: vi.fn().mockResolvedValue(undefined) };
    openCheckout = vi.fn<SeatCheckoutOpener>().mockResolvedValue({
      url: "https://checkout.example/seat",
      subscriptionId: "sub_db_checkout",
    });
    pricingModel = "SEAT_EVENT";
    const seats = SeatEventSubscriptionService.create({
      stripeSubscriptions,
      subscriptions,
      abandoned: { seatCheckoutsAbandoned: vi.fn(), audited: vi.fn() },
      prices,
      customerCurrency: StripeCustomerCurrencyService.create({
        customers,
        stripeErrors: StripeErrorTranslatorService.create(),
      }),
      duplicates,
    });
    service = SeatPurchaseService.create({
      seats,
      stripeSubscriptions,
      stripeInvoices,
      subscriptions,
      pricingModel: async () => pricingModel,
      openCheckout,
    });
  });

  /** ACME's invoice at Stripe in `status`: a seat invoice for 3 seats, or a held change's. */
  const seedInvoice = (
    status: "open" | "paid" | "void",
    {
      seatInvoice = true,
      created = nowSeconds(),
    }: { seatInvoice?: boolean; created?: number } = {},
  ) =>
    stripeInvoices.seed({
      invoice: {
        id: "in_seat",
        customerId: "cus_acme",
        number: null,
        created,
        amountDue: 519,
        currency: "usd",
        status,
        pdfUrl: null,
        hostedUrl: "https://invoice.example/in_seat",
      },
      seatPurchase: seatInvoice ? { subscriptionId: "sub_stripe_1", seats: 3 } : null,
    });

  describe("offer()", () => {
    /** @scenario "The seat offer prices one more seat before anything is charged" */
    it("prices one more seat, today's amount, the new total and the renewal day", async () => {
      const offer = await service.offer({ organizationId: ORG });

      expect(offer).toMatchObject({
        kind: "charge",
        newTotalSeats: 3,
        formattedAmountDue: "$5.19",
        formattedRecurringTotal: "$102",
        billingInterval: "month",
        renewsAt: PERIOD_END_SECONDS * 1000,
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "A plan without paid seats has no seat offer" */
    it("offers nothing on a plan without seat billing", async () => {
      pricingModel = "TIERED";

      expect(await service.offer({ organizationId: ORG })).toEqual({ kind: "none" });
    });

    /** @scenario "A plan with no Stripe subscription buys the seat through checkout" */
    it("offers a checkout for an operator-added plan", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, stripeSubscriptionId: null },
      ]);

      expect(await service.offer({ organizationId: ORG })).toEqual({
        kind: "checkout",
        newTotalSeats: 3,
      });
    });

    /** @scenario "Stuck billing refuses the seat by name" */
    it("is blocked while two subscriptions are live in Stripe", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, id: "sub_db_a", stripeSubscriptionId: "sub_stripe_a" },
        { ...linkedActive, id: "sub_db_b", stripeSubscriptionId: "sub_stripe_b" },
      ]);
      stripeSubscriptions.seed({ subscription: seatSubscription(2, "sub_stripe_a") });
      stripeSubscriptions.seed({ subscription: seatSubscription(2, "sub_stripe_b") });

      expect(await service.offer({ organizationId: ORG })).toEqual({ kind: "blocked" });
    });

    /** @scenario "A plan on custom terms points to support for the seat" */
    it("points to support on a hand-made plan with no Stripe link", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, plan: "ENTERPRISE", stripeSubscriptionId: null },
      ]);

      expect(await service.offer({ organizationId: ORG })).toEqual({ kind: "support" });
      expect(stripeSubscriptions.updates).toEqual([]);
    });
  });

  describe("addFullSeat()", () => {
    /** @scenario "One click charges the seat and makes the member an Admin" */
    it("bills the proration on its own invoice, then raises the line with no proration", async () => {
      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(result).toEqual({ status: "added" });
      expect(stripeInvoices.seatCharges).toEqual([
        {
          customerId: "cus_acme",
          purpose: { subscriptionId: "sub_stripe_1", seats: 3 },
          amountCents: 519,
        },
      ]);
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        },
      ]);
      expect(subscriptions.reactivateWithSeats).toHaveBeenCalledWith(
        expect.objectContaining({ id: "sub_db_1", maxMembers: 3 }),
      );
    });

    /** @scenario "A charge needing the customer opens the seat invoice and changes nothing yet" */
    it("answers the invoice's payment page and leaves the seat line alone", async () => {
      stripeInvoices.chargeNextSeatInvoice({
        status: "open",
        hostedUrl: "https://invoice.example/in_seat_1",
      });

      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(result).toEqual({
        status: "payment_required",
        payment: { kind: "invoice", invoiceId: "in_seat_1", seats: 3 },
        url: "https://invoice.example/in_seat_1",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
    });

    /** @scenario "A charge needing the customer opens the seat invoice and changes nothing yet" */
    it("bills the proration lines alone, leaving any usage in the preview to the cycle", async () => {
      stripeSubscriptions.seedPreview({
        preview: { currency: "usd", total: 2519, amountDue: 2519, prorations: 519 },
      });

      await service.addFullSeat({ organizationId: ORG, ...START });

      expect(stripeInvoices.seatCharges).toEqual([expect.objectContaining({ amountCents: 519 })]);
    });

    it("keeps the seat as paid and waiting when the paid seat fails to land on the line", async () => {
      stripeSubscriptions.refuse({ operation: "updateSubscription", error: new Error("timeout") });

      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(result).toMatchObject({
        status: "payment_required",
        payment: { kind: "invoice", invoiceId: "in_seat_1", seats: 3 },
      });
    });

    /** @scenario "Two seat purchases at once buy two seats" */
    it("reads the seat line again once it holds the lease", async () => {
      // Another purchase lands its seat while this one waits for the lease.
      subscriptions.claimSeatLine.mockImplementationOnce(async () => {
        stripeSubscriptions.seed({ subscription: seatSubscription(3) });
        return { claimed: true, token: "lease_1" };
      });

      await service.addFullSeat({ organizationId: ORG, ...START });

      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: expect.objectContaining({ items: [{ id: "si_seat", quantity: 4 }] }),
        },
      ]);
      expect(subscriptions.reactivateWithSeats).toHaveBeenCalledWith(
        expect.objectContaining({ maxMembers: 4 }),
      );
    });

    /** @scenario "A purchase while a seat payment waits reopens that payment" */
    it("answers the open seat invoice and bills no second one", async () => {
      seedInvoice("open");

      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(result).toEqual({
        status: "payment_required",
        payment: { kind: "invoice", invoiceId: "in_seat", seats: 3 },
        url: "https://invoice.example/in_seat",
      });
      expect(stripeInvoices.seatCharges).toEqual([]);
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "A seat invoice left unpaid for a day is voided" */
    it("voids an open seat invoice past its day and bills a fresh one", async () => {
      seedInvoice("open", { created: nowSeconds() - SEAT_INVOICE_LIFETIME_SECONDS });

      await service.addFullSeat({ organizationId: ORG, ...START });

      expect(stripeInvoices.voided).toEqual(["in_seat"]);
      expect(stripeInvoices.seatCharges).toHaveLength(1);
    });

    /** @scenario "A purchase while a seat payment waits reopens that payment" */
    it("answers the invoice Stripe already holds and sends no second change", async () => {
      stripeSubscriptions.seed({
        subscription: {
          ...seatSubscription(2),
          pendingUpdate: true,
          latestInvoice: { id: "in_seat", status: null, hostedUrl: null },
        },
      });
      seedInvoice("open");

      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(result).toEqual({
        status: "payment_required",
        payment: { kind: "invoice", invoiceId: "in_seat", seats: 3 },
        url: "https://invoice.example/in_seat",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "A seat invoice with no payment page is voided and refused" */
    it("voids a seat invoice that names no payment page and refuses by name", async () => {
      stripeInvoices.chargeNextSeatInvoice({ status: "open", hostedUrl: null });

      await expect(service.addFullSeat({ organizationId: ORG, ...START })).rejects.toMatchObject({
        code: "seat_payment_unavailable",
      });
      expect(stripeInvoices.voided).toEqual(["in_seat_1"]);
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
    });

    /** @scenario "A plan with no Stripe subscription buys the seat through checkout" */
    it("opens a seat checkout for one more seat that returns where the change asked", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, stripeSubscriptionId: null },
      ]);

      const result = await service.addFullSeat({ organizationId: ORG, ...START });

      expect(openCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, successPath: "/back", membersToAdd: 3 }),
      );
      expect(result).toEqual({
        status: "payment_required",
        payment: { kind: "checkout", subscriptionId: "sub_db_checkout" },
        url: "https://checkout.example/seat",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "Stuck billing refuses the seat by name" */
    it("refuses with subscription_ambiguous, charges nothing and alerts ops", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, id: "sub_db_a", stripeSubscriptionId: "sub_stripe_a" },
        { ...linkedActive, id: "sub_db_b", stripeSubscriptionId: "sub_stripe_b" },
      ]);
      stripeSubscriptions.seed({ subscription: seatSubscription(2, "sub_stripe_a") });
      stripeSubscriptions.seed({ subscription: seatSubscription(2, "sub_stripe_b") });

      await expect(service.addFullSeat({ organizationId: ORG, ...START })).rejects.toMatchObject({
        code: "subscription_ambiguous",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(duplicates.reportDuplicateActive).toHaveBeenCalled();
    });
  });

  describe("settle()", () => {
    const invoice = { kind: "invoice", invoiceId: "in_seat", seats: 3 } as const;

    /** @scenario "An unpaid seat invoice keeps the change waiting" */
    it("keeps an open seat invoice waiting within its day", async () => {
      seedInvoice("open");

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "open",
      });
      expect(stripeInvoices.voided).toEqual([]);
    });

    /** @scenario "A seat change Stripe held before seat invoices settles once Stripe applies it" */
    it("keeps an open held-change invoice waiting while Stripe holds its change", async () => {
      seedInvoice("open", { seatInvoice: false });
      stripeSubscriptions.seed({ subscription: { ...seatSubscription(2), pendingUpdate: true } });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "open",
      });
    });

    /** @scenario "A failed or abandoned payment changes nothing" */
    it("fails a voided invoice and records no seat", async () => {
      seedInvoice("void");

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "failed",
      });
      expect(subscriptions.reactivateWithSeats).not.toHaveBeenCalled();
    });

    /** @scenario "The paid invoice applies the change, then the return changes nothing" */
    it("records the seat Stripe applied once the invoice is paid", async () => {
      seedInvoice("paid");
      stripeSubscriptions.seed({ subscription: seatSubscription(3) });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "paid",
      });
      expect(subscriptions.reactivateWithSeats).toHaveBeenCalledWith(
        expect.objectContaining({ id: "sub_db_1", maxMembers: 3 }),
      );
    });

    /** @scenario "A seat invoice left unpaid for a day is voided" */
    it("voids an open seat invoice past its day, and fails it", async () => {
      seedInvoice("open", { created: nowSeconds() - SEAT_INVOICE_LIFETIME_SECONDS });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "failed",
      });
      expect(stripeInvoices.voided).toEqual(["in_seat"]);
    });

    it("voids an open held-change invoice whose change Stripe dropped, and fails it", async () => {
      seedInvoice("open", { seatInvoice: false });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "failed",
      });
      expect(stripeInvoices.voided).toEqual(["in_seat"]);
    });

    /** @scenario "A paid seat invoice raises the seat line it was bought for" */
    it("raises the line with no proration once its seat invoice is paid", async () => {
      seedInvoice("paid");

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "paid",
      });
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        },
      ]);
      expect(subscriptions.reactivateWithSeats).toHaveBeenCalledWith(
        expect.objectContaining({ id: "sub_db_1", maxMembers: 3 }),
      );
    });

    /** @scenario "A seat change Stripe held before seat invoices settles once Stripe applies it" */
    it("keeps a paid held-change invoice waiting until Stripe applies its change", async () => {
      seedInvoice("paid", { seatInvoice: false });
      stripeSubscriptions.seed({ subscription: { ...seatSubscription(2), pendingUpdate: true } });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "open",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    it("fails a paid held-change invoice whose change Stripe dropped", async () => {
      seedInvoice("paid", { seatInvoice: false });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "failed",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    it("settles nothing for a seat invoice bought for another subscription", async () => {
      stripeInvoices.seed({
        invoice: {
          id: "in_seat",
          customerId: "cus_acme",
          number: null,
          created: nowSeconds(),
          amountDue: 519,
          currency: "usd",
          status: "paid",
          pdfUrl: null,
          hostedUrl: null,
        },
        seatPurchase: { subscriptionId: "sub_stripe_other", seats: 3 },
      });

      expect(await service.settle({ organizationId: ORG, payment: invoice })).toEqual({
        status: "failed",
      });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    it("settles nothing for another customer's invoice", async () => {
      stripeInvoices.seed({
        invoice: {
          id: "in_other",
          customerId: "cus_other",
          number: null,
          created: 0,
          amountDue: 519,
          currency: "usd",
          status: "paid",
          pdfUrl: null,
          hostedUrl: null,
        },
      });

      expect(
        await service.settle({
          organizationId: ORG,
          payment: { kind: "invoice", invoiceId: "in_other", seats: 3 },
        }),
      ).toEqual({ status: "failed" });
    });

    /** @scenario "An adopted seat checkout waits for its own paid fact" */
    it("keeps an adopted seat checkout open: only its paid fact proves it", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, maxMembers: 3 },
        {
          id: "sub_db_checkout",
          stripeSubscriptionId: null,
          status: SubscriptionStatus.CANCELLED,
          maxMembers: 3,
          ...NO_KEPT,
        },
      ]);

      expect(
        await service.settle({
          organizationId: ORG,
          payment: { kind: "checkout", subscriptionId: "sub_db_checkout" },
        }),
      ).toEqual({ status: "open" });
    });

    /** @scenario "A plan with no Stripe subscription buys the seat through checkout" */
    it("counts a seat checkout row that turned active as paid", async () => {
      subscriptions.findSeatCandidates.mockResolvedValue([
        { ...linkedActive, id: "sub_db_checkout", maxMembers: 3 },
      ]);

      expect(
        await service.settle({
          organizationId: ORG,
          payment: { kind: "checkout", subscriptionId: "sub_db_checkout" },
        }),
      ).toEqual({ status: "paid" });
    });
  });
});
