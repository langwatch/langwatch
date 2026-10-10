import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    notifications: {},
    dataRetention: { policy: {} },
  }),
}));

import type Stripe from "stripe";
import type { OrganizationRepository } from "../../../src/server/app-layer/organizations/repositories/organization.repository";
import type { SubscriptionRepository } from "../../../src/server/app-layer/subscription/subscription.repository";
import {
  type ConnectedBillingInvoiceEvents,
  EEWebhookService,
} from "../services/webhookService";

/**
 * The `invoice.finalized` branch for a connected self-hosted customer
 * (ADR-141, section 7). The service behind it has its own suite; what is
 * proven here is the routing: whose invoices it acts on, and whose it leaves.
 */

function connectedBilling(
  account: { organizationId: string } | null,
): ConnectedBillingInvoiceEvents & {
  completeRenewalIfDue: ReturnType<typeof vi.fn>;
} {
  return {
    accountFor: vi.fn().mockResolvedValue(account),
    completeRenewalIfDue: vi.fn().mockResolvedValue("completed"),
  };
}

function buildService(events: ConnectedBillingInvoiceEvents) {
  return new EEWebhookService({
    subscriptionRepository: {} as SubscriptionRepository,
    organizationRepository: {} as OrganizationRepository,
    stripe: {} as Stripe,
    itemCalculator: {
      calculateQuantityForPrice: vi.fn(),
      prices: {},
    } as never,
    connectedBilling: events,
  });
}

const finalized = (customer: string) =>
  ({
    id: "evt_1",
    type: "invoice.finalized",
    data: { object: { id: "in_1", customer } },
  }) as unknown as Stripe.Event;

describe("a finalized invoice", () => {
  describe("given it belongs to a connected self-hosted customer", () => {
    it("finishes a renewal that was waiting", async () => {
      const events = connectedBilling({ organizationId: "org_acme" });

      const result = await buildService(events).handleEvent(
        finalized("cus_acme"),
      );

      expect(result).toEqual({ status: "ok" });
      expect(events.completeRenewalIfDue).toHaveBeenCalledWith({
        organizationId: "org_acme",
      });
    });
  });

  describe("given it belongs to a LangWatch Cloud customer", () => {
    it("is left alone", async () => {
      const events = connectedBilling(null);

      const result = await buildService(events).handleEvent(
        finalized("cus_cloud"),
      );

      expect(result).toEqual({ status: "ok" });
      expect(events.completeRenewalIfDue).not.toHaveBeenCalled();
    });
  });
});
