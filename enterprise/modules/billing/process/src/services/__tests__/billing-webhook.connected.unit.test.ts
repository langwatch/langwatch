/**
 * The `invoice.finalized` branch for a connected self-hosted customer (ADR-156,
 * section 7): whose invoices it acts on, and whose it leaves.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { ConnectedBillingNotOnboardedError } from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import type { BillingWebhookHost } from "../../channels/billing-webhook-host.channel.ts";
import type { BillingWebhookOrganization } from "../../repositories/billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscription } from "../../repositories/billing-webhook-subscription.repository.ts";
import {
  type ConnectedBillingInvoiceEvents,
  EEWebhookService,
} from "../billing-stripe-webhook.service.ts";

type WebhookOptions = Parameters<typeof EEWebhookService.create>[0];

function connectedBilling(account: { organizationId: string } | null) {
  return {
    getAccountByCustomer: vi.fn(async () => {
      if (account === null) throw new ConnectedBillingNotOnboardedError();
      return account;
    }),
    completeRenewalIfDue: vi.fn(async () => "completed"),
  } satisfies ConnectedBillingInvoiceEvents;
}

function buildService(events: ConnectedBillingInvoiceEvents): EEWebhookService {
  return EEWebhookService.create({
    subscriptionRepository: createApiFixture<BillingWebhookSubscription>(),
    organizationRepository: createApiFixture<BillingWebhookOrganization>(),
    stripe: createApiFixture<Stripe>(),
    itemCalculator: createApiFixture<WebhookOptions["itemCalculator"]>(),
    host: createApiFixture<BillingWebhookHost>(),
    connectedBilling: events,
  });
}

function finalized(customer: string): Stripe.InvoiceFinalizedEvent {
  return createApiFixture<Stripe.InvoiceFinalizedEvent>({
    id: "evt_1",
    type: "invoice.finalized",
    data: createApiFixture<Stripe.InvoiceFinalizedEvent.Data>({
      object: createApiFixture<Stripe.Invoice>({ id: "in_1", customer }),
    }),
  });
}

describe("a finalized invoice", () => {
  describe("given it belongs to a connected self-hosted customer", () => {
    it("finishes a renewal that was waiting", async () => {
      const events = connectedBilling({ organizationId: "org_acme" });

      const result = await buildService(events).handleEvent(finalized("cus_acme"));

      expect(result).toEqual({ status: "ok" });
      expect(events.getAccountByCustomer).toHaveBeenCalledWith("cus_acme");
      expect(events.completeRenewalIfDue).toHaveBeenCalledWith({ organizationId: "org_acme" });
    });
  });

  describe("given it belongs to a LangWatch Cloud customer", () => {
    it("is left alone", async () => {
      const events = connectedBilling(null);

      const result = await buildService(events).handleEvent(finalized("cus_cloud"));

      expect(result).toEqual({ status: "ok" });
      expect(events.completeRenewalIfDue).not.toHaveBeenCalled();
    });
  });
});
