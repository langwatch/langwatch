/**
 * The live pieces of main's licence purchase: licensing signs with the key the
 * process resolved, and the licence is recorded, mailed and announced.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensePurchaseNotificationPayload } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { MemoryLicenseEmailChannel } from "../../channels/memory/memory.license-email.channel.ts";
import { LicensePurchaseDeliveryService } from "../license-purchase-delivery.service.ts";
import { LicensingLicenseGeneratorService } from "../licensing-license-generator.service.ts";

describe("the licence a purchase generates", () => {
  it("is signed by licensing on main's GROWTH tier with the key the process resolved", async () => {
    const asked: unknown[] = [];
    const licensing = createApiFixture<Pick<LicensingApi, "generateLicenseKey">>({
      generateLicenseKey: async (input) => {
        asked.push(input);
        return {
          licenseKey: "key_1",
          licenseData: {
            licenseId: "lic_1",
            version: 1,
            organizationName: "Acme",
            email: "buyer@acme.example",
            issuedAt: "2026-09-27T00:00:00.000Z",
            expiresAt: "2027-09-27T00:00:00.000Z",
            plan: {
              type: "GROWTH",
              name: "Growth",
              maxMembers: 4,
              maxMessagesPerMonth: 1,
              canPublish: true,
            },
          },
        };
      },
    });

    const generated = await LicensingLicenseGeneratorService.create({
      licensing,
      privateKey: "resolved-key",
    }).generate({ organizationName: "Acme", email: "buyer@acme.example", maxMembers: 4 });

    expect(asked).toEqual([
      {
        organizationName: "Acme",
        email: "buyer@acme.example",
        maxMembers: 4,
        planType: "GROWTH",
        privateKey: "resolved-key",
      },
    ]);
    expect(generated).toEqual({
      licenseKey: "key_1",
      licenseData: {
        licenseId: "lic_1",
        plan: { type: "GROWTH" },
        expiresAt: "2027-09-27T00:00:00.000Z",
        organizationName: "Acme",
      },
    });
  });
});

describe("a purchased licence's delivery", () => {
  it("records it as a purchase, mails it, and announces it", async () => {
    const recorded: unknown[] = [];
    const announced: LicensePurchaseNotificationPayload[] = [];
    const mail = MemoryLicenseEmailChannel.create();
    const delivery = LicensePurchaseDeliveryService.create({
      licensing: createApiFixture<Pick<LicensingApi, "recordIssuedLicense">>({
        recordIssuedLicense: async (input) => {
          recorded.push(input);
          return createApiFixture({});
        },
      }),
      mail,
      notices: {
        sendSlackLicensePurchase: async (payload) => {
          announced.push(payload);
        },
      },
    });
    const email = {
      email: "buyer@acme.example",
      licenseKey: "key_1",
      planType: "GROWTH",
      maxMembers: 4,
      expiresAt: "2027-09-27T00:00:00.000Z",
      organizationName: "Acme",
    };
    const notification = {
      buyerEmail: "buyer@acme.example",
      planType: "GROWTH",
      seats: 4,
      amountPaid: 1200,
      currency: "eur",
    };

    await delivery.recordLicense({ licenseKey: "key_1" });
    await delivery.sendLicenseEmail(email);
    await delivery.notifyLicensePurchase(notification);

    expect(recorded).toEqual([{ licenseKey: "key_1", source: "PURCHASE" }]);
    expect(mail.sent).toEqual([email]);
    expect(announced).toEqual([notification]);
  });
});
