import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import {
  LicensePurchaseService,
  type LicenseEmailDelivery,
  type LicenseFeaturesResolver,
  type LicenseGenerator,
  type LicensePurchaseDelivery,
} from "../license-purchase.service.ts";

/**
 * Spec: packages/enterprise/features/billing/specs/stripe-webhook.feature
 */

function checkoutSession(): Stripe.Checkout.Session {
  return {
    id: "cs_1",
    customer_details: { email: "buyer@acme.example", name: "Acme Corp" },
    amount_total: 99_900,
    currency: "usd",
  } as unknown as Stripe.Checkout.Session;
}

function fakeStripe(): Stripe {
  return {
    checkout: {
      sessions: {
        listLineItems: vi.fn(async () => ({ data: [{ quantity: 1 }] })),
      },
    },
  } as unknown as Stripe;
}

function composeService(licenseFeatures?: LicenseFeaturesResolver) {
  const sendLicenseEmail = vi.fn(async (_: LicenseEmailDelivery) => undefined);
  const notifyLicensePurchase = vi.fn(async () => undefined);
  const delivery = {
    sendLicenseEmail,
    notifyLicensePurchase,
  } as unknown as LicensePurchaseDelivery;
  const generateLicense = {
    generate: () => ({
      licenseKey: "key_1",
      licenseData: {
        licenseId: "lic_1",
        plan: { type: "ACCELERATE" },
        expiresAt: "2027-01-01T00:00:00.000Z",
        organizationName: "Acme Corp",
      },
    }),
  } as unknown as LicenseGenerator;
  const service = LicensePurchaseService.create({
    delivery,
    generateLicense,
    ...(licenseFeatures ? { licenseFeatures } : {}),
  });
  return { service, sendLicenseEmail };
}

describe("LicensePurchaseService", () => {
  describe("when the issued tier is on the self-serve ladder", () => {
    /** @scenario "A licence checkout links what the issued tier unlocks" */
    it("passes a self-serve unlocked-features link to the mail", async () => {
      const licenseFeatures = {
        resolve: vi.fn(async () => ({
          kind: "self_serve" as const,
          url: "https://app.langwatch.ai/pricing",
        })),
      };
      const { service, sendLicenseEmail } = composeService(licenseFeatures);

      await service.handle({
        checkoutSession: checkoutSession(),
        stripe: fakeStripe(),
        privateKey: "priv",
      });

      expect(licenseFeatures.resolve).toHaveBeenCalledWith({ planType: "ACCELERATE" });
      expect(sendLicenseEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          unlockedFeatures: { kind: "self_serve", url: "https://app.langwatch.ai/pricing" },
        }),
      );
    });
  });

  describe("when the tier resolves to account-managed terms", () => {
    /** @scenario "A licence checkout for a negotiated tier names the account team" */
    it("passes an account-team contact to the mail", async () => {
      const licenseFeatures = {
        resolve: vi.fn(async () => ({
          kind: "account_team" as const,
          contactUrl: "https://langwatch.ai/contact",
        })),
      };
      const { service, sendLicenseEmail } = composeService(licenseFeatures);

      await service.handle({
        checkoutSession: checkoutSession(),
        stripe: fakeStripe(),
        privateKey: "priv",
      });

      expect(sendLicenseEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          unlockedFeatures: { kind: "account_team", contactUrl: "https://langwatch.ai/contact" },
        }),
      );
    });
  });

  describe("when the deployment composed no catalogue resolver", () => {
    /** @scenario "A licence checkout with no catalogue composed sends without the link" */
    it("sends the licence mail without unlocked features", async () => {
      const { service, sendLicenseEmail } = composeService();

      await service.handle({
        checkoutSession: checkoutSession(),
        stripe: fakeStripe(),
        privateKey: "priv",
      });

      const sent = sendLicenseEmail.mock.calls[0]?.[0];
      expect(sent?.unlockedFeatures).toBeUndefined();
    });
  });
});
