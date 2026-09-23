import { describe, expect, it, vi } from "vitest";

import { BillingErrorReporter } from "../services/billing-error-reporter.service.ts";
import {
  LicenseGenerator,
  LicensePurchaseDelivery,
  LicensePurchaseService,
} from "../services/license-purchase.service.ts";

class TestLicenseGenerator extends LicenseGenerator {
  readonly generate = vi.fn().mockReturnValue({
    licenseKey: "license-key",
    licenseData: {
      licenseId: "license-id",
      plan: { type: "GROWTH" },
      expiresAt: "2030-01-01T00:00:00.000Z",
      organizationName: "Acme",
    },
  });
}

class TestLicensePurchaseDelivery extends LicensePurchaseDelivery {
  readonly recordLicense = vi.fn().mockResolvedValue(undefined);
  readonly sendLicenseEmail = vi.fn().mockResolvedValue(undefined);
  readonly notifyLicensePurchase = vi.fn().mockResolvedValue(undefined);
}

describe("LicensePurchaseService", () => {
  /** @scenario Use business name as organization name in license */
  it("loads seats, generates a license, then delivers email and notification", async () => {
    const delivery = new TestLicensePurchaseDelivery();
    const generator = new TestLicenseGenerator();
    const service = LicensePurchaseService.create({
      delivery,
      generateLicense: generator,
    });
    const stripe = {
      checkout: {
        sessions: {
          listLineItems: vi.fn().mockResolvedValue({ data: [{ quantity: 4 }] }),
        },
      },
    } as any;

    await service.handle({
      checkoutSession: {
        id: "checkout_1",
        customer_details: { email: "buyer@example.com", name: "Acme" },
        amount_total: 1200,
        currency: "eur",
      } as any,
      stripe,
      privateKey: "private-key",
    });

    expect(generator.generate).toHaveBeenCalledWith({
      organizationName: "Acme",
      email: "buyer@example.com",
      maxMembers: 4,
      privateKey: "private-key",
    });
    expect(delivery.sendLicenseEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "buyer@example.com",
        licenseKey: "license-key",
        maxMembers: 4,
      }),
    );
    expect(delivery.notifyLicensePurchase).toHaveBeenCalledWith({
      buyerEmail: "buyer@example.com",
      planType: "GROWTH",
      seats: 4,
      amountPaid: 1200,
      currency: "eur",
    });
  });

  describe("when a checkout completes", () => {
    /** @scenario A license bought through the payment link is recorded */
    it("records the same license that is emailed to the buyer", async () => {
      const delivery = new TestLicensePurchaseDelivery();
      await purchase({ delivery });

      expect(delivery.recordLicense).toHaveBeenCalledTimes(1);
      expect(delivery.recordLicense).toHaveBeenCalledWith({ licenseKey: "license-key" });
      expect(delivery.sendLicenseEmail).toHaveBeenCalledWith(
        expect.objectContaining({ licenseKey: "license-key" }),
      );
    });
  });

  describe("when the registry cannot be written", () => {
    /** @scenario A purchase still delivers its license when the registry cannot be written */
    it("still emails the license and reports the failure", async () => {
      const delivery = new TestLicensePurchaseDelivery();
      delivery.recordLicense.mockRejectedValue(new Error("registry unavailable"));
      const errorReporter = new RecordingErrorReporter();

      await expect(purchase({ delivery, errorReporter })).resolves.toBeUndefined();

      expect(delivery.sendLicenseEmail).toHaveBeenCalledTimes(1);
      expect(errorReporter.captured).toHaveLength(1);
    });
  });
});

class RecordingErrorReporter extends BillingErrorReporter {
  readonly captured: Error[] = [];
  capture(error: Error): void {
    this.captured.push(error);
  }
}

async function purchase({
  delivery,
  errorReporter,
}: {
  delivery: TestLicensePurchaseDelivery;
  errorReporter?: BillingErrorReporter;
}): Promise<void> {
  const service = LicensePurchaseService.create({
    delivery,
    generateLicense: new TestLicenseGenerator(),
    ...(errorReporter ? { errorReporter } : {}),
  });
  await service.handle({
    checkoutSession: {
      id: "checkout_1",
      customer_details: { email: "buyer@example.com", name: "Acme" },
      amount_total: 1200,
      currency: "eur",
    },
    stripe: {
      checkout: { sessions: { listLineItems: async () => ({ data: [{ quantity: 4 }] }) } },
    },
    privateKey: "private-key",
  });
}
