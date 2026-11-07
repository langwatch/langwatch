/**
 * Growth seats are added now, prorated, and lowered from the next billing cycle, through the
 * seat service, the subscription webhook and the plan the seat limit reads, on memory twins.
 * @see specs/licensing/seat-rotation.feature
 */
import { SeatChangeBusyError, type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { MemorySeatEventSubscriptionRepository } from "../repositories/memory/memory.seat-event-subscription.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../repositories/memory/memory.subscription.repository.ts";
import type { BillingSubscriptionStatus } from "../rules/billing-stripe-shapes.rules.ts";
import { BillingSubscriptionLifecycleService } from "../services/billing-subscription-lifecycle.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";
import { SeatEventSubscriptionService } from "../services/seat-event-subscription.service.ts";
import {
  SEAT_LINE_LEASE_MS,
  SEAT_LINE_WRITE_TIMEOUT_MS,
} from "../services/seat-line-lease.service.ts";
import {
  SEAT_REPAIR_FLAG_AFTER_ATTEMPTS,
  SEAT_REPAIR_GRACE_MS,
  SeatLineRepairService,
} from "../services/seat-line-repair.service.ts";
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

const NOW = Temporal.Instant.from("2026-11-06T12:00:00Z");
const PERIOD_END = Temporal.Instant.from("2026-12-01T00:00:00Z");
const PERIOD_END_SECONDS = PERIOD_END.epochMilliseconds / 1000;
const SEAT_PRICE_CENTS = 2900;

/** The provider's update event once the line bills 3 seats; only the fields the sync reads. */
const PROVIDER_AT_THREE = {
  id: "sub_stripe_1",
  status: "active",
  ended_at: null,
  items: { data: [{ price: { id: prices.GROWTH_SEAT_EUR_MONTHLY }, quantity: 3 }] },
} as Stripe.Subscription;

describe("Growth seat changes", () => {
  let store: MemoryBillingStore;
  let stripeSubscriptions: MemoryStripeSubscriptionsChannel;
  let seats: SeatEventSubscriptionService;
  let plans: SaaSPlanProviderService;
  let lifecycle: BillingSubscriptionLifecycleService;

  /** The provider's seat line as it bills `quantity` seats this period, `status` at Stripe. */
  const seedProvider = (quantity: number, status: BillingSubscriptionStatus = "active") =>
    stripeSubscriptions.seed({
      subscription: {
        id: "sub_stripe_1",
        status,
        canceledAt: null,
        billingThreshold: null,
        currentPeriodEnd: PERIOD_END_SECONDS,
        currency: "eur",
        items: [
          {
            id: "si_seat",
            priceId: prices.GROWTH_SEAT_EUR_MONTHLY,
            unitAmount: SEAT_PRICE_CENTS,
            interval: "month",
            quantity,
          },
        ],
      },
    });

  const planSeats = async () => (await plans.getActivePlan("org_1")).maxMembers;

  /** Holds the next Stripe read until `resume` is called, as a slow call would. */
  const pauseNextRead = () => {
    const read = stripeSubscriptions.getSubscription.bind(stripeSubscriptions);
    const pause = { resume: () => {} };
    const spy = vi
      .spyOn(stripeSubscriptions, "getSubscription")
      .mockImplementationOnce(async (input) => {
        const subscription = await read(input);
        await new Promise<void>((resolve) => (pause.resume = resolve));
        return subscription;
      });
    return { pause, restore: () => spy.mockRestore() };
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW.epochMilliseconds, toFake: ["Date", "setTimeout"] });
    store = MemoryBillingStore.create();
    store.organizations.set("org_1", {
      id: "org_1",
      name: "ACME",
      stripeCustomerId: "cus_1",
      pricingModel: "SEAT_EVENT",
      currency: "EUR",
      selfHostedCustomer: false,
      teamIds: [],
      signupData: {},
    });
    store.subscriptions.push({
      id: "sub_db_1",
      organizationId: "org_1",
      status: "ACTIVE",
      plan: "GROWTH_SEAT_EUR_MONTHLY",
      stripeSubscriptionId: "sub_stripe_1",
      createdAt: NOW.subtract({ hours: 24 * 40 }),
      startDate: NOW.subtract({ hours: 24 * 40 }),
      endDate: null,
      maxMembers: 5,
      maxMembersLite: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
    stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
    seedProvider(5);
    const customers = MemoryStripeCustomersChannel.create();
    customers.seed({ id: "cus_1", currency: "eur" });
    seats = SeatEventSubscriptionService.create({
      stripeSubscriptions,
      subscriptions: MemorySeatEventSubscriptionRepository.create(store),
      abandoned: { seatCheckoutsAbandoned: vi.fn() },
      prices,
      customerCurrency: StripeCustomerCurrencyService.create({
        customers,
        stripeErrors: StripeErrorTranslatorService.create(),
      }),
    });
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);
    plans = SaaSPlanProviderService.create({ subscriptions, isSaas: true });
    lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
      organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
      licenses: createApiFixture<LicensingApi>({
        getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
      }),
      stripeSubscriptions,
      itemCalculator: { calculateQuantityForPrice: vi.fn().mockReturnValue(0), prices },
      host: {
        sendSlackSubscriptionEvent: vi.fn(),
        sendSlackBillingThresholdFailureAlert: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when an administrator raises the seats", () => {
    /** @scenario "Adding seats charges the prorated amount now" */
    it("invoices the prorated difference at once and grants the seats at once", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: {
            items: [{ id: "si_seat", quantity: 6 }],
            prorationBehavior: "always_invoice",
            prorationDate: Math.floor(NOW.epochMilliseconds / 1000),
          },
        },
      ]);
      expect(await planSeats()).toBe(6);
    });
  });

  describe("when an administrator lowers the seats", () => {
    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("changes the quantity with no proration and keeps the seats paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });

      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        },
      ]);
      expect(await planSeats()).toBe(5);

      vi.setSystemTime(PERIOD_END.add({ hours: 1 }).epochMilliseconds);
      expect(await planSeats()).toBe(3);
    });

    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("keeps the seats when the provider reports the lower quantity before the period ends", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });

      const synced = lifecycle.handleSubscriptionUpdated({ subscription: PROVIDER_AT_THREE });
      await vi.advanceTimersByTimeAsync(2000);
      await synced;

      expect(store.subscriptions[0]?.maxMembers).toBe(3);
      expect(await planSeats()).toBe(5);
    });

    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("keeps the seats paid for when the provider lowered the line but the record failed", async () => {
      const repository = MemorySeatEventSubscriptionRepository.create(store);
      const failingRecord = SeatEventSubscriptionService.create({
        stripeSubscriptions,
        subscriptions: createApiFixture<MemorySeatEventSubscriptionRepository>({
          findSeatCandidates: (input) => repository.findSeatCandidates(input),
          claimSeatLine: (input) => repository.claimSeatLine(input),
          renewSeatLine: (input) => repository.renewSeatLine(input),
          releaseSeatLine: (input) => repository.releaseSeatLine(input),
          beginSeatLineWrite: (input) => repository.beginSeatLineWrite(input),
          finishSeatLineWrite: (input) => repository.finishSeatLineWrite(input),
          keepSeats: (input) => repository.keepSeats(input),
          reactivateWithSeats: async () => {
            throw new Error("database unavailable");
          },
        }),
        abandoned: { seatCheckoutsAbandoned: vi.fn() },
        prices,
        customerCurrency: StripeCustomerCurrencyService.create({
          customers: MemoryStripeCustomersChannel.create(),
          stripeErrors: StripeErrorTranslatorService.create(),
        }),
      });

      await expect(
        failingRecord.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 }),
      ).rejects.toThrow("database unavailable");
      const synced = lifecycle.handleSubscriptionUpdated({ subscription: PROVIDER_AT_THREE });
      await vi.advanceTimersByTimeAsync(2000);
      await synced;

      expect(store.subscriptions[0]?.maxMembers).toBe(3);
      expect(await planSeats()).toBe(5);
    });

    it("previews nothing due today and the day the lower count applies", async () => {
      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 3 });

      expect(quote).toMatchObject({
        amountDueCents: 0,
        formattedRecurringTotal: "€87",
        appliesAt: PERIOD_END.epochMilliseconds,
        keptSeats: 5,
        formattedKeptRecurringTotal: "€145",
      });
      expect(stripeSubscriptions.previews).toEqual([]);
    });
  });

  describe("when an administrator raises the seats again before the kept seats run out", () => {
    beforeEach(async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });
      seedProvider(3);
      stripeSubscriptions.updates.length = 0;
    });

    it("charges nothing for a count within the seats already paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 4 });

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 4 }], prorationBehavior: "none" },
      ]);
      expect(await planSeats()).toBe(5);
    });

    it("charges only the seats above the ones already paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
        expect.objectContaining({
          items: [{ id: "si_seat", quantity: 6 }],
          prorationBehavior: "always_invoice",
        }),
      ]);
      expect(await planSeats()).toBe(6);
    });

    /** @scenario "A refused charge after a lift puts the seat line back" */
    it("puts the line back when the charge after the lift is refused", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("card declined"),
        allowed: 1,
        times: 1,
      });

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("card declined");

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
      ]);
      expect(store.subscriptions[0]).toMatchObject({ maxMembers: 3, seatsKept: 5 });
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line Stripe refused to put back is recorded for repair" */
    it("reports the refused charge when putting the line back fails too", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("card declined"),
        allowed: 1,
        times: 2,
      });

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("card declined");

      // The lifted line stays; the kept seats recorded first still cover what Stripe bills.
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
      ]);
      expect(store.subscriptions[0]).toMatchObject({ maxMembers: 3, seatsKept: 5 });
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({
        quantity: 3,
        liftedQuantity: 5,
        attempts: 0,
        flaggedAt: null,
      });
    });

    /** @scenario "A seat change that waited plans from the seats as the change before it left them" */
    it("plans a waiting change from the kept seats the decrease before it recorded", async () => {
      const paused = pauseNextRead();
      const lowering = seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });
      await vi.advanceTimersByTimeAsync(0);
      paused.restore();
      const raising = seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 4 });
      await vi.advanceTimersByTimeAsync(500);

      paused.pause.resume();
      await lowering;
      seedProvider(3);
      await vi.advanceTimersByTimeAsync(500);
      await raising;

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        { items: [{ id: "si_seat", quantity: 4 }], prorationBehavior: "none" },
      ]);
      expect(await planSeats()).toBe(5);
    });

    /** @scenario "A seat change refused while another one keeps running" */
    it("refuses a seat change while another holds the seat line past the wait", async () => {
      await MemorySeatEventSubscriptionRepository.create(store).claimSeatLine({
        id: "sub_db_1",
        leaseMs: SEAT_LINE_LEASE_MS,
      });

      const change = seats
        .updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(await change).toBeInstanceOf(SeatChangeBusyError);

      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "A seat change records the repair before it lifts the seat line" */
    it("records the way back before the lift and clears it once the change completes", async () => {
      const send = stripeSubscriptions.updateSubscription.bind(stripeSubscriptions);
      const recordedAtLift: unknown[] = [];
      vi.spyOn(stripeSubscriptions, "updateSubscription").mockImplementation(async (input) => {
        recordedAtLift.push(store.seatRepairs.get("sub_db_1"));
        return send(input);
      });

      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      expect(recordedAtLift[0]).toMatchObject({ quantity: 3, liftedQuantity: 5 });
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat change whose repair cannot be recorded leaves Stripe alone" */
    it("errors without touching Stripe when the repair cannot be recorded", async () => {
      const repository = MemorySeatEventSubscriptionRepository.create(store);
      const unrecorded = SeatEventSubscriptionService.create({
        stripeSubscriptions,
        subscriptions: createApiFixture<MemorySeatEventSubscriptionRepository>({
          findSeatCandidates: (input) => repository.findSeatCandidates(input),
          claimSeatLine: (input) => repository.claimSeatLine(input),
          renewSeatLine: (input) => repository.renewSeatLine(input),
          releaseSeatLine: (input) => repository.releaseSeatLine(input),
          beginSeatLineWrite: (input) => repository.beginSeatLineWrite(input),
          finishSeatLineWrite: (input) => repository.finishSeatLineWrite(input),
          keepSeats: (input) => repository.keepSeats(input),
          recordSeatRepair: async () => {
            throw new Error("database unavailable");
          },
        }),
        abandoned: { seatCheckoutsAbandoned: vi.fn() },
        prices,
        customerCurrency: StripeCustomerCurrencyService.create({
          customers: MemoryStripeCustomersChannel.create(),
          stripeErrors: StripeErrorTranslatorService.create(),
        }),
      });

      await expect(
        unrecorded.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("database unavailable");

      expect(stripeSubscriptions.updates).toEqual([]);
    });

    it("quotes the share of the previewed proration above the seats already paid for", async () => {
      // The preview prices the move from 3 to 6, the lift the move from 3 to 5; one seat is due.
      stripeSubscriptions.seedPreview({
        preview: { total: 5400, amountDue: 5400, currency: "eur" },
        quantity: 6,
      });
      stripeSubscriptions.seedPreview({
        preview: { total: 3600, amountDue: 3600, currency: "eur" },
        quantity: 5,
      });

      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 6 });

      expect(quote).toMatchObject({ amountDueCents: 1800, appliesAt: null, keptSeats: null });
    });

    /** @scenario "Amount due counts prorations the subscription already carried" */
    it("quotes a carried proration in full beside the seat above the ones paid for", async () => {
      // 1000 carried from an earlier change sits on both previews; one seat costs 1800.
      stripeSubscriptions.seedPreview({
        preview: { total: 6400, amountDue: 6400, currency: "eur" },
        quantity: 6,
      });
      stripeSubscriptions.seedPreview({
        preview: { total: 4600, amountDue: 4600, currency: "eur" },
        quantity: 5,
      });

      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 6 });

      expect(quote.amountDueCents).toBe(2800);
    });
  });

  describe("when Stripe left a seat line lifted after a refused rollback", () => {
    let repairs: SeatLineRepairService;

    beforeEach(async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });
      seedProvider(3);
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("card declined"),
        allowed: 1,
        times: 2,
      });
      // The refused charge and the refused rollback leave the line at 5 and record a repair.
      await seats
        .updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 })
        .catch(() => undefined);
      seedProvider(5);
      stripeSubscriptions.updates.length = 0;
      repairs = SeatLineRepairService.create({
        stripeSubscriptions,
        subscriptions: MemorySeatEventSubscriptionRepository.create(store),
        prices,
      });
      vi.setSystemTime(NOW.add({ milliseconds: SEAT_REPAIR_GRACE_MS + 1 }).epochMilliseconds);
    });

    /** @scenario "A seat line write that lands after a seat change took its lease is put right" */
    it("leaves a late write pending and the next pass restores the newer count", async () => {
      const send = stripeSubscriptions.updateSubscription.bind(stripeSubscriptions);
      const stall = { resume: () => {} };
      const writes = vi
        .spyOn(stripeSubscriptions, "updateSubscription")
        .mockImplementationOnce(async (input) => {
          await new Promise<void>((resolve) => (stall.resume = resolve));
          const sent = await send(input);
          seedProvider(3);
          return sent;
        });
      const repairing = repairs.repairSeatLines();
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + SEAT_LINE_LEASE_MS + 1);
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });
      expect(stripeSubscriptions.updates.length).toBeGreaterThan(0);

      stall.resume();

      expect(await repairing).toMatchObject({ repaired: 0, pending: 1, failed: 0 });
      expect(stripeSubscriptions.updates.at(-1)?.change).toEqual({
        items: [{ id: "si_seat", quantity: 3 }],
        prorationBehavior: "none",
      });
      expect(store.seatLineWrites.size).toBe(1);
      writes.mockRestore();
      stripeSubscriptions.updates.length = 0;

      vi.setSystemTime(Date.now() + SEAT_REPAIR_GRACE_MS + 1);
      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 1, failed: 0 });
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 6 }], prorationBehavior: "none" },
      ]);
      expect(store.seatLineWrites.size).toBe(0);
    });

    /** @scenario "Seat line writes give up well inside the lease" */
    it("sends every seat line write with a one minute request timeout", async () => {
      const writes = vi.spyOn(stripeSubscriptions, "updateSubscription");

      await repairs.repairSeatLines();
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      const timeouts = writes.mock.calls.map(([input]) => input.timeoutMs);
      expect(timeouts.length).toBeGreaterThan(1);
      expect(timeouts).toEqual(timeouts.map(() => 60 * 1000));
      expect(2 * SEAT_LINE_WRITE_TIMEOUT_MS).toBeLessThan(SEAT_LINE_LEASE_MS);
      writes.mockRestore();
    });

    /** @scenario "A seat line Stripe refused to put back is repaired later" */
    it("puts the line back to the recorded quantity with no proration and clears the repair", async () => {
      const outcome = await repairs.repairSeatLines();

      expect(outcome).toEqual({ repaired: 1, pending: 0, failed: 0, flagged: 0 });
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        },
      ]);
      expect(store.seatRepairs.size).toBe(0);
      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 0, failed: 0 });
    });

    /** @scenario "A seat line Stripe already bills right clears its repair without a change" */
    it("clears the repair without a change when Stripe already bills the recorded quantity", async () => {
      seedProvider(3);

      await repairs.repairSeatLines();

      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A later seat change replaces a pending repair" */
    it("clears the repair once a later seat change succeeds", async () => {
      seedProvider(3);
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 4 });

      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line at the charged count clears its repair without a change" */
    it("clears the repair without a change when Stripe bills the charged count", async () => {
      seedProvider(6);

      await repairs.repairSeatLines();

      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line a later change moved is left alone" */
    it("clears the repair without a change when a later change moved the line", async () => {
      seedProvider(4);
      store.seatLineTargets.set("sub_db_1", { quantity: 4, at: Temporal.Now.instant() });

      await repairs.repairSeatLines();

      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line a later change moved is left alone" */
    it("leaves the line and the newer record when a change replaces the record mid-pass", async () => {
      const repository = MemorySeatEventSubscriptionRepository.create(store);
      const racing = SeatLineRepairService.create({
        stripeSubscriptions,
        prices,
        subscriptions: createApiFixture<MemorySeatEventSubscriptionRepository>({
          findSeatRepairs: (input) => repository.findSeatRepairs(input),
          findSeatLineWrites: async () => [],
          claimSeatLine: (input) => repository.claimSeatLine(input),
          renewSeatLine: (input) => repository.renewSeatLine(input),
          releaseSeatLine: (input) => repository.releaseSeatLine(input),
          isSeatRepairPending: async (input) => {
            vi.advanceTimersByTime(1);
            await repository.recordSeatRepair({ id: "sub_db_1", quantity: 5, liftedQuantity: 7 });
            return repository.isSeatRepairPending(input);
          },
          clearSeatRepair: (input) => repository.clearSeatRepair(input),
        }),
      });

      await racing.repairSeatLines();

      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 5, liftedQuantity: 7 });
    });

    /** @scenario "A seat change waits for a seat line repair on the same subscription" */
    it("runs a seat change only after a repair that read Stripe has finished", async () => {
      const read = stripeSubscriptions.getSubscription.bind(stripeSubscriptions);
      let resumeRepair = () => {};
      const paused = vi
        .spyOn(stripeSubscriptions, "getSubscription")
        .mockImplementationOnce(async (input) => {
          const subscription = await read(input);
          await new Promise<void>((resolve) => (resumeRepair = resolve));
          return subscription;
        });

      const repairing = repairs.repairSeatLines();
      await vi.advanceTimersByTimeAsync(0);
      paused.mockRestore();
      const changing = seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(stripeSubscriptions.updates).toEqual([]);

      resumeRepair();
      expect(await repairing).toMatchObject({ repaired: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      await changing;

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        expect.objectContaining({
          items: [{ id: "si_seat", quantity: 6 }],
          prorationBehavior: "always_invoice",
        }),
      ]);
    });

    /** @scenario "A seat line repair whose lease ran out and was taken over does not write" */
    it("stops without writing when its lease ran out and another holder took it", async () => {
      const paused = pauseNextRead();
      const repairing = repairs.repairSeatLines();
      await vi.advanceTimersByTimeAsync(0);
      paused.restore();
      vi.setSystemTime(Date.now() + SEAT_LINE_LEASE_MS + 1);
      const takeover = await MemorySeatEventSubscriptionRepository.create(store).claimSeatLine({
        id: "sub_db_1",
        leaseMs: SEAT_LINE_LEASE_MS,
      });
      expect(takeover.claimed).toBe(true);

      paused.pause.resume();

      // The lift record and the writes the refused change left both wait for the next pass.
      expect(await repairing).toMatchObject({ repaired: 0, pending: 2, failed: 0 });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 3, liftedQuantity: 5 });
    });

    /** @scenario "A seat line repair skips a subscription a seat change is working on" */
    it("leaves the repair pending while a seat change holds the seat line", async () => {
      await MemorySeatEventSubscriptionRepository.create(store).claimSeatLine({
        id: "sub_db_1",
        leaseMs: SEAT_LINE_LEASE_MS,
      });
      const reads = stripeSubscriptions.reads.length;

      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 0, pending: 2 });
      expect(stripeSubscriptions.reads).toHaveLength(reads);
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 3, liftedQuantity: 5 });
    });

    /** @scenario "A seat line repair moves the line on a past due subscription" */
    it("moves the line on a past due subscription", async () => {
      seedProvider(5, "past_due");

      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 1 });
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
      ]);
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line repair stays pending while Stripe cannot change the subscription" */
    it("keeps the repair pending, uncounted, while the subscription is incomplete", async () => {
      seedProvider(5, "incomplete");

      expect(await repairs.repairSeatLines()).toEqual({
        repaired: 0,
        pending: 2,
        failed: 0,
        flagged: 0,
      });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 3, attempts: 0 });
    });

    /** @scenario "A seat line repair on a canceled subscription is cleared" */
    it("clears the repair without a change once the subscription is canceled", async () => {
      seedProvider(5, "canceled");

      await repairs.repairSeatLines();

      expect(stripeSubscriptions.updates).toEqual([]);
      expect(store.seatRepairs.size).toBe(0);
    });

    it("counts a refused repair and retries it on the next pass", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("rate limited"),
        allowed: 0,
        times: 1,
      });

      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 0, failed: 1, flagged: 0 });
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 3, attempts: 1 });

      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 1, failed: 0, flagged: 0 });
      expect(store.seatRepairs.size).toBe(0);
    });

    /** @scenario "A seat line still wrong after retries is flagged to Ops" */
    it("flags the subscription to Ops after repeated refusals and clears the flag on success", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("provider unavailable"),
        allowed: 0,
        times: SEAT_REPAIR_FLAG_AFTER_ATTEMPTS + 1,
      });

      const passes = [];
      for (let pass = 0; pass < SEAT_REPAIR_FLAG_AFTER_ATTEMPTS + 1; pass++) {
        passes.push(await repairs.repairSeatLines());
      }

      expect(passes.map((outcome) => outcome.flagged)).toEqual([0, 0, 0, 0, 1, 0]);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({
        quantity: 3,
        attempts: SEAT_REPAIR_FLAG_AFTER_ATTEMPTS + 1,
        flaggedAt: NOW,
      });

      await repairs.repairSeatLines();

      expect(store.seatRepairs.size).toBe(0);
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
      ]);
    });
  });
  describe("when the database fails around a Stripe seat line write", () => {
    const repairsOn = () =>
      SeatLineRepairService.create({
        stripeSubscriptions,
        subscriptions: MemorySeatEventSubscriptionRepository.create(store),
        prices,
      });

    /** @scenario "A database outage right after a Stripe write still leaves a repair that runs" */
    it("keeps the write pending after a refused clear and the repair settles it", async () => {
      const clear = vi
        .spyOn(MemorySeatEventSubscriptionRepository.prototype, "finishSeatLineWrite")
        .mockRejectedValueOnce(new Error("database unavailable"));

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 }),
      ).rejects.toThrow("database unavailable");
      clear.mockRestore();
      seedProvider(3);
      expect(store.seatLineWrites.get("sub_db_1")).toMatchObject({ quantities: [3] });
      stripeSubscriptions.updates.length = 0;

      vi.setSystemTime(Date.now() + SEAT_REPAIR_GRACE_MS + 1);
      expect(await repairsOn().repairSeatLines()).toMatchObject({ repaired: 1, failed: 0 });
      expect(stripeSubscriptions.updates).toHaveLength(0);
      expect(store.seatLineTargets.get("sub_db_1")).toMatchObject({ quantity: 3 });
      expect(store.seatLineWrites.size).toBe(0);
    });

    /** @scenario "A seat line write the database refuses to record ahead is never sent" */
    it("never calls Stripe when the write cannot be recorded ahead", async () => {
      const record = vi
        .spyOn(MemorySeatEventSubscriptionRepository.prototype, "beginSeatLineWrite")
        .mockRejectedValueOnce(new Error("database unavailable"));

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("database unavailable");

      expect(stripeSubscriptions.updates).toHaveLength(0);
      record.mockRestore();
    });
  });

  describe("when a seat change stops after it lifted the seat line", () => {
    let repairs: SeatLineRepairService;

    beforeEach(async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });
      seedProvider(3);
      stripeSubscriptions.updates.length = 0;
      // The lift goes through; the charge never answers, as when the process stops mid-change.
      const send = stripeSubscriptions.updateSubscription.bind(stripeSubscriptions);
      const stalled = vi
        .spyOn(stripeSubscriptions, "updateSubscription")
        .mockImplementationOnce(send)
        .mockImplementationOnce(() => new Promise(() => {}));
      void seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });
      await vi.advanceTimersByTimeAsync(0);
      stalled.mockRestore();
      seedProvider(5);
      stripeSubscriptions.updates.length = 0;
      repairs = SeatLineRepairService.create({
        stripeSubscriptions,
        subscriptions: MemorySeatEventSubscriptionRepository.create(store),
        prices,
      });
    });

    /** @scenario "A seat line repair waits out a change that may still be running" */
    it("leaves a repair younger than the grace window alone", async () => {
      const reads = stripeSubscriptions.reads.length;

      expect(await repairs.repairSeatLines()).toEqual({
        repaired: 0,
        pending: 0,
        failed: 0,
        flagged: 0,
      });
      expect(stripeSubscriptions.reads).toHaveLength(reads);
      expect(store.seatRepairs.get("sub_db_1")).toMatchObject({ quantity: 3, liftedQuantity: 5 });
    });

    /** @scenario "A seat line left lifted by a stopped change is put back" */
    it("puts the lifted line back once the grace window passed", async () => {
      vi.setSystemTime(NOW.add({ milliseconds: SEAT_REPAIR_GRACE_MS + 1 }).epochMilliseconds);

      expect(await repairs.repairSeatLines()).toMatchObject({ repaired: 1 });
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
      ]);
      expect(store.seatRepairs.size).toBe(0);
    });
  });
});
