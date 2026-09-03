import { describe, expect, it, vi } from "vitest";
import {
  LicenseGenerator,
  LicensePurchaseDelivery,
  LicensePurchaseService,
} from "../index";

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
});
