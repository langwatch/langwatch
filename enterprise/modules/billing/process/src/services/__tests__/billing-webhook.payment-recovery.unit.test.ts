/**
 * @vitest-environment node
 *
 * The Stripe callback hands invoice events to failed payment recovery: a failure, both paid
 * events, a void and a write-off, and answers 500 when recovery cannot record the failure.
 * @see ../../../../specs/payment-recovery.feature
 */
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import {
  EEWebhookService,
  type PaymentRecoveryHandler,
} from "../billing-stripe-webhook.service.ts";
import type { RecoveryInvoice } from "../payment-recovery.service.ts";

type Call = { operation: keyof PaymentRecoveryHandler; invoice: RecoveryInvoice };

/** Records what recovery was handed; `failNext` makes the next call throw. */
class RecordingRecovery implements PaymentRecoveryHandler {
  readonly calls: Call[] = [];
  failNext: Error | null = null;

  async paymentFailed({ invoice }: { invoice: RecoveryInvoice }) {
    this.record({ operation: "paymentFailed", invoice });
  }
  async invoicePaid({ invoice }: { invoice: RecoveryInvoice }) {
    this.record({ operation: "invoicePaid", invoice });
  }
  async invoiceClosedUnpaid({ invoice }: { invoice: RecoveryInvoice }) {
    this.record({ operation: "invoiceClosedUnpaid", invoice });
  }

  private record(call: Call) {
    const failure = this.failNext;
    this.failNext = null;
    if (failure) throw failure;
    this.calls.push(call);
  }
}

const INVOICE = createApiFixture<Stripe.Invoice>({
  id: "in_renewal",
  subscription: "sub_stripe_1",
  customer: null,
  collection_method: "charge_automatically",
  billing_reason: "subscription_cycle",
  amount_due: 28072,
  currency: "eur",
  number: "LW-0042",
  created: 1_793_000_000,
});

type InvoiceEventType =
  | "invoice.payment_failed"
  | "invoice.paid"
  | "invoice.payment_succeeded"
  | "invoice.voided"
  | "invoice.marked_uncollectible";

function eventOf(type: InvoiceEventType): Stripe.Event {
  const id = `evt_${type}`;
  const data = { object: INVOICE };
  switch (type) {
    case "invoice.payment_failed":
      return createApiFixture<Stripe.InvoicePaymentFailedEvent>({ id, type, data });
    case "invoice.paid":
      return createApiFixture<Stripe.InvoicePaidEvent>({ id, type, data });
    case "invoice.payment_succeeded":
      return createApiFixture<Stripe.InvoicePaymentSucceededEvent>({ id, type, data });
    case "invoice.voided":
      return createApiFixture<Stripe.InvoiceVoidedEvent>({ id, type, data });
    case "invoice.marked_uncollectible":
      return createApiFixture<Stripe.InvoiceMarkedUncollectibleEvent>({ id, type, data });
  }
}

describe("given the Stripe callback with payment recovery composed", () => {
  let recovery: RecordingRecovery;
  let webhook: EEWebhookService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const store = MemoryBillingStore.create();
    store.subscriptions.push({
      id: "sub_db_1",
      organizationId: "org_1",
      status: "ACTIVE",
      plan: "GROWTH_SEAT_EUR_MONTHLY",
      stripeSubscriptionId: "sub_stripe_1",
      createdAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
      startDate: null,
      endDate: null,
      maxMembers: 5,
      maxMembersLite: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);
    recovery = new RecordingRecovery();
    webhook = EEWebhookService.create({
      subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
      organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
      stripeSubscriptions: MemoryStripeSubscriptionsChannel.create(),
      itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as never },
      licenses: createApiFixture<LicensingApi>({
        getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
      }),
      host: {
        sendSlackSubscriptionEvent: async () => {},
        sendSlackBillingThresholdFailureAlert: async () => {},
        sendSlackAccountPaymentFailed: async () => {},
      },
      recovery,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const handled = async (type: InvoiceEventType) => {
    const result = webhook.handleEvent(eventOf(type));
    await vi.advanceTimersByTimeAsync(5000);
    return result;
  };

  it("hands a payment failure to recovery with the invoice fields it reads", async () => {
    expect(await handled("invoice.payment_failed")).toEqual({ status: "ok" });

    expect(recovery.calls).toEqual([
      {
        operation: "paymentFailed",
        invoice: {
          id: "in_renewal",
          subscriptionId: "sub_stripe_1",
          collectionMethod: "charge_automatically",
          billingReason: "subscription_cycle",
          amountDue: 28072,
          currency: "eur",
          number: "LW-0042",
          created: 1_793_000_000,
        },
      },
    ]);
  });

  /** @scenario "Both paid events of one invoice close the case once" */
  it("hands both paid events of one invoice to recovery, which closes the case once", async () => {
    await handled("invoice.paid");
    await handled("invoice.payment_succeeded");

    expect(recovery.calls.map((call) => call.operation)).toEqual(["invoicePaid", "invoicePaid"]);
  });

  /** @scenario "An invoice voided or marked uncollectible by staff closes the case" */
  it("hands a voided and a written-off invoice to recovery", async () => {
    expect(await handled("invoice.voided")).toEqual({ status: "ok" });
    expect(await handled("invoice.marked_uncollectible")).toEqual({ status: "ok" });

    expect(recovery.calls.map((call) => call.operation)).toEqual([
      "invoiceClosedUnpaid",
      "invoiceClosedUnpaid",
    ]);
  });

  /** @scenario "A database failure while opening a case makes Stripe retry" */
  it("answers 500 when recovery cannot record the failure, so Stripe redelivers", async () => {
    recovery.failNext = new Error("connection refused");

    expect(await handled("invoice.payment_failed")).toMatchObject({
      status: "error",
      httpStatus: 500,
    });
    expect(await handled("invoice.payment_failed")).toEqual({ status: "ok" });
    expect(recovery.calls).toHaveLength(1);
  });
});
