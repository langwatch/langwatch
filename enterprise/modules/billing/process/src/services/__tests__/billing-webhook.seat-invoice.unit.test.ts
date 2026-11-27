/**
 * @vitest-environment node
 *
 * The Stripe callback announces a paid seat invoice, so the role change waiting on it settles.
 * @see ../../../../../../../specs/licensing/role-change-seat.feature
 */
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import { seatInvoiceMetadata } from "../../rules/seat-invoice.rules.ts";
import type { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { EEWebhookService } from "../billing-stripe-webhook.service.ts";

const paidEvent = (invoice: Partial<Stripe.Invoice>): Stripe.Event =>
  createApiFixture<Stripe.InvoicePaidEvent>({
    id: `evt_${invoice.id}`,
    type: "invoice.paid",
    data: {
      object: createApiFixture<Stripe.Invoice>({
        subscription: null,
        customer: "cus_acme",
        collection_method: "charge_automatically",
        amount_due: 519,
        currency: "usd",
        number: null,
        created: 1_793_000_000,
        metadata: {},
        ...invoice,
      }),
    },
  });

describe("given the Stripe callback with the lifecycle announcer composed", () => {
  let seatInvoicePaid: Mock<BillingLifecycleAnnouncerService["seatInvoicePaid"]>;
  let webhook: EEWebhookService;

  beforeEach(() => {
    const store = MemoryBillingStore.create();
    store.organizations.set("org_acme", {
      id: "org_acme",
      name: "ACME",
      stripeCustomerId: "cus_acme",
      pricingModel: "SEAT_EVENT",
      currency: "USD",
      selfHostedCustomer: false,
      teamIds: [],
      signupData: {},
    });
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);
    seatInvoicePaid = vi
      .fn<BillingLifecycleAnnouncerService["seatInvoicePaid"]>()
      .mockResolvedValue(undefined);
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
      announcer: createApiFixture<BillingLifecycleAnnouncerService>({ seatInvoicePaid }),
    });
  });

  /** @scenario "The paid invoice applies the change, then the return changes nothing" */
  it("announces a paid seat invoice billed outside the cycle", async () => {
    const event = paidEvent({
      id: "in_seat_1",
      billing_reason: "manual",
      metadata: seatInvoiceMetadata({ subscriptionId: "sub_stripe_1", seats: 3 }),
    });

    expect(await webhook.handleEvent(event)).toEqual({ status: "ok" });
    expect(seatInvoicePaid).toHaveBeenCalledWith({
      organizationId: "org_acme",
      invoiceId: "in_seat_1",
    });
  });

  it("announces nothing for a paid one-off invoice that buys no seat", async () => {
    const event = paidEvent({ id: "in_other", billing_reason: "manual" });

    expect(await webhook.handleEvent(event)).toEqual({ status: "ok" });
    expect(seatInvoicePaid).not.toHaveBeenCalled();
  });
});
