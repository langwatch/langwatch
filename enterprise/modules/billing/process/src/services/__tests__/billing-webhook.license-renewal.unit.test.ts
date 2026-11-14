/**
 * @see specs/licensing/self-serving-license-purchase.feature
 */
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryBillingWebhookHostChannel } from "../../channels/memory/memory.billing-webhook-host.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import {
  LicenseGenerator,
  LicensePurchaseDelivery,
  LicensePurchaseService,
} from "../../features/license-purchase/services/license-purchase.service.ts";
import { LicenseRenewalService } from "../../features/license-purchase/services/license-renewal.service.ts";
import type { BillingWebhookOrganizationRepository } from "../../repositories/billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "../../repositories/billing-webhook-subscription.repository.ts";
import { MemoryLicenseRenewalClaimRepository } from "../../repositories/memory/memory.license-renewal-claim.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { EEWebhookService } from "../billing-stripe-webhook.service.ts";

const LICENSE_LINK = "plink_license";
const PERIOD_END = Temporal.Instant.from("2028-01-01T00:00:00Z").epochMilliseconds / 1000;

class RecordingLicenseGenerator extends LicenseGenerator {
  readonly generate = vi.fn(async (input: { expiresAt?: Instant; organizationName: string }) => ({
    licenseKey: `key-${this.generate.mock.calls.length}`,
    licenseData: {
      licenseId: `lic-${this.generate.mock.calls.length}`,
      plan: { type: "GROWTH" },
      expiresAt: (input.expiresAt ?? Temporal.Instant.fromEpochMilliseconds(0)).toString(),
      organizationName: input.organizationName,
    },
  }));
}

class RecordingDelivery extends LicensePurchaseDelivery {
  readonly recordLicense = vi.fn().mockResolvedValue(undefined);
  readonly sendLicenseEmail = vi.fn().mockResolvedValue(undefined);
  readonly notifyLicensePurchase = vi.fn().mockResolvedValue(undefined);
}

function invoiceEvent({
  type = "invoice.paid",
  invoiceId = "in_renewal",
  billingReason = "subscription_cycle",
  subscriptionId = "sub_license",
  seats = 7,
}: {
  type?: "invoice.paid" | "invoice.payment_succeeded";
  invoiceId?: string;
  billingReason?: Stripe.Invoice.BillingReason;
  subscriptionId?: string;
  seats?: number;
} = {}): Stripe.InvoicePaidEvent | Stripe.InvoicePaymentSucceededEvent {
  const object = createApiFixture<Stripe.Invoice>({
    id: invoiceId,
    billing_reason: billingReason,
    subscription: subscriptionId,
    customer: null,
    customer_email: "buyer@acme.test",
    customer_name: "ACME",
    amount_paid: 70_000,
    currency: "eur",
    lines: createApiFixture<Stripe.ApiList<Stripe.InvoiceLineItem>>({
      data: [
        createApiFixture<Stripe.InvoiceLineItem>({
          type: "subscription",
          quantity: seats,
          period: { start: 0, end: PERIOD_END },
        }),
      ],
    }),
  });
  const id = `evt_${type}_${invoiceId}`;
  return type === "invoice.paid"
    ? createApiFixture<Stripe.InvoicePaidEvent>({ id, type, data: { object } })
    : createApiFixture<Stripe.InvoicePaymentSucceededEvent>({ id, type, data: { object } });
}

function webhookWithRenewal({
  cloudSubscriptions = new Map<string, BillingSubscriptionRecord>(),
}: { cloudSubscriptions?: Map<string, BillingSubscriptionRecord> } = {}) {
  const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  const generator = new RecordingLicenseGenerator();
  const delivery = new RecordingDelivery();
  const claims = MemoryLicenseRenewalClaimRepository.create();
  const findByStripeId = vi.fn(async (id: string) => cloudSubscriptions.get(id) ?? null);
  const subscriptionRepository = createApiFixture<BillingWebhookSubscriptionRepository>({
    findByStripeId,
  });
  const purchase = LicensePurchaseService.create({ delivery, generateLicense: generator });
  const webhook = EEWebhookService.create({
    subscriptionRepository,
    organizationRepository: createApiFixture<BillingWebhookOrganizationRepository>({
      findByStripeCustomerId: async () => null,
    }),
    stripeSubscriptions,
    itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as never },
    licenses: createApiFixture<Pick<LicensingApi, "removeLicense" | "getLicenseStatus">>({}),
    licensePaymentLinkId: LICENSE_LINK,
    licenseRenewal: LicenseRenewalService.create({
      licensePaymentLinkId: LICENSE_LINK,
      subscriptions: subscriptionRepository,
      stripeSubscriptions,
      claims,
      issuer: purchase,
    }),
    host: MemoryBillingWebhookHostChannel.create(),
  });
  stripeSubscriptions.seedSubscriptionCheckout({
    subscriptionId: "sub_license",
    checkout: { checkoutSessionId: "cs_license", paymentLinkId: LICENSE_LINK },
  });
  stripeSubscriptions.seedSubscriptionCheckout({
    subscriptionId: "sub_other",
    checkout: { checkoutSessionId: "cs_other", paymentLinkId: "plink_other" },
  });
  return { webhook, generator, delivery, claims, stripeSubscriptions, findByStripeId };
}

describe("EEWebhookService license renewals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a subscription bought through the license payment link", () => {
    describe("when its yearly renewal invoice is paid", () => {
      /** @scenario "Renewal of a licence subscription mints the next term's licence" */
      it("generates the next term's licence for the invoiced seats and delivers it", async () => {
        const { webhook, generator, delivery } = webhookWithRenewal();

        const result = await webhook.handleEvent(invoiceEvent());

        expect(result).toEqual({ status: "ok" });
        expect(generator.generate).toHaveBeenCalledWith({
          organizationName: "ACME",
          email: "buyer@acme.test",
          maxMembers: 7,
          expiresAt: Temporal.Instant.from("2028-01-01T00:00:00Z"),
        });
        expect(delivery.recordLicense).toHaveBeenCalledWith({ licenseKey: "key-1" });
        expect(delivery.sendLicenseEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "buyer@acme.test",
            licenseKey: "key-1",
            maxMembers: 7,
            expiresAt: "2028-01-01T00:00:00Z",
          }),
        );
        expect(delivery.notifyLicensePurchase).toHaveBeenCalledWith({
          buyerEmail: "buyer@acme.test",
          planType: "GROWTH",
          seats: 7,
          amountPaid: 70_000,
          currency: "eur",
        });
      });

      /** @scenario "Renewal of a licence subscription bought before renewals were handled" */
      it("recognises the subscription from its checkout session's payment link", async () => {
        const { webhook, stripeSubscriptions, delivery } = webhookWithRenewal();

        await webhook.handleEvent(invoiceEvent({ type: "invoice.payment_succeeded" }));

        expect(stripeSubscriptions.checkoutLookups).toEqual(["sub_license"]);
        expect(delivery.sendLicenseEmail).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the same invoice is delivered again", () => {
      /** @scenario "A redelivered renewal invoice mints nothing more" */
      it("mints and mails only once across both paid events and a redelivery", async () => {
        const { webhook, generator, delivery } = webhookWithRenewal();

        await webhook.handleEvent(invoiceEvent({ type: "invoice.paid" }));
        await webhook.handleEvent(invoiceEvent({ type: "invoice.payment_succeeded" }));
        const redelivered = await webhook.handleEvent(invoiceEvent({ type: "invoice.paid" }));

        expect(redelivered).toEqual({ status: "ok" });
        expect(generator.generate).toHaveBeenCalledTimes(1);
        expect(delivery.sendLicenseEmail).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the renewal email fails", () => {
      /** @scenario "A failed renewal delivery is retried by Stripe" */
      it("answers 500 and mails the licence it already minted on Stripe's retry", async () => {
        const { webhook, generator, delivery, claims } = webhookWithRenewal();
        delivery.sendLicenseEmail.mockRejectedValueOnce(new Error("mail down"));

        const failed = await webhook.handleEvent(invoiceEvent());
        expect(failed).toMatchObject({ status: "error", httpStatus: 500 });
        expect(claims.rows.get("in_renewal")?.deliveredAt).toBeNull();

        const retried = await webhook.handleEvent(invoiceEvent());
        expect(retried).toEqual({ status: "ok" });
        expect(generator.generate).toHaveBeenCalledTimes(1);
        expect(delivery.recordLicense).toHaveBeenCalledTimes(1);
        expect(delivery.sendLicenseEmail).toHaveBeenCalledTimes(2);
        expect(delivery.sendLicenseEmail).toHaveBeenLastCalledWith(
          expect.objectContaining({ licenseKey: "key-1" }),
        );
        const row = claims.rows.get("in_renewal");
        expect(row?.deliveredAt).toBeInstanceOf(Temporal.Instant);
        expect(row?.issuedLicense).toBeNull();
      });
    });

    describe("when its first invoice is paid", () => {
      /** @scenario "The first invoice of a licence subscription is not a renewal" */
      it("mints no renewal and asks Stripe nothing", async () => {
        const { webhook, generator, stripeSubscriptions } = webhookWithRenewal();

        await webhook.handleEvent(invoiceEvent({ billingReason: "subscription_create" }));

        expect(generator.generate).not.toHaveBeenCalled();
        expect(stripeSubscriptions.checkoutLookups).toEqual([]);
      });
    });
  });

  describe("given a subscription bought through another payment link", () => {
    describe("when its renewal invoice payment succeeds", () => {
      /** @scenario "Renewal of a subscription not bought through the license payment link is untouched" */
      it("mints nothing and runs the subscription invoice flow", async () => {
        const { webhook, generator, findByStripeId } = webhookWithRenewal();

        const handled = webhook.handleEvent(
          invoiceEvent({ type: "invoice.payment_succeeded", subscriptionId: "sub_other" }),
        );
        await vi.runAllTimersAsync();

        expect(await handled).toEqual({ status: "ok" });
        expect(generator.generate).not.toHaveBeenCalled();
        // Once by the renewal check, once by the subscription flow that follows.
        expect(findByStripeId).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a subscription billing holds as a LangWatch Cloud plan", () => {
    describe("when its renewal invoice is paid", () => {
      /** @scenario "Renewal of a LangWatch Cloud subscription asks Stripe nothing extra" */
      it("looks up no checkout session and mints nothing", async () => {
        const cloudSubscriptions = new Map([
          ["sub_cloud", { id: "subscription_1" } as BillingSubscriptionRecord],
        ]);
        const { webhook, generator, stripeSubscriptions } = webhookWithRenewal({
          cloudSubscriptions,
        });

        await webhook.handleEvent(invoiceEvent({ subscriptionId: "sub_cloud" }));

        expect(stripeSubscriptions.checkoutLookups).toEqual([]);
        expect(generator.generate).not.toHaveBeenCalled();
      });
    });
  });
});
