import { describe, expect, it } from "vitest";

import {
  EmailProviderConfigurationError,
  type MailGatewaySettings,
} from "../../channels/email-delivery.channel.ts";
import { MailDeliveryService } from "../mail-delivery.service.ts";

function settingsWith(overrides: Partial<MailGatewaySettings> = {}): MailGatewaySettings {
  return {
    provider: undefined,
    ses: { enabled: false },
    sendgrid: {},
    smtp: {},
    resend: {},
    ...overrides,
  };
}

function serviceOver(settings: MailGatewaySettings) {
  return MailDeliveryService.create({ settings: () => Promise.resolve(settings) });
}

describe("MailDeliveryService", () => {
  describe("when EMAIL_PROVIDER names SMTP and a relay is set", () => {
    it("names the gateway and says SMTP is configured", async () => {
      const view = await serviceOver(
        settingsWith({ provider: "smtp", smtp: { host: "mail.acme.test" } }),
      ).getView();

      expect(view).toEqual({ provider: "smtp", smtpConfigured: true });
    });
  });

  describe("when nothing is configured", () => {
    it("names no gateway", async () => {
      await expect(serviceOver(settingsWith()).getView()).resolves.toEqual({
        smtpConfigured: false,
      });
    });
  });

  describe("when EMAIL_PROVIDER names a gateway whose settings are missing", () => {
    it("reads as no gateway rather than failing the checkup", async () => {
      await expect(serviceOver(settingsWith({ provider: "resend" })).getView()).resolves.toEqual({
        smtpConfigured: false,
      });
    });
  });

  describe("when verifying SMTP with no relay named", () => {
    it("refuses with the configuration error before opening anything", async () => {
      await expect(serviceOver(settingsWith()).verifySmtp()).rejects.toBeInstanceOf(
        EmailProviderConfigurationError,
      );
    });
  });
});
