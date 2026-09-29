import {
  notificationBrowserConfig,
  type NotificationServerConfig,
} from "@langwatch/notification-contract";
import { describe, expect, it } from "vitest";

import {
  type EmailContent,
  EmailDelivery,
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

const config: NotificationServerConfig = {
  defaultFrom: undefined,
  provider: undefined,
  ses: { enabled: undefined, region: undefined, endpoint: undefined },
  smtp: { host: undefined, port: undefined, user: undefined, secure: undefined },
};

/** The gateway-facing message each send is handed, recorded rather than delivered. */
class RecordingDelivery extends EmailDelivery {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.test>";
  }

  async send(content: EmailContent): Promise<void> {
    this.sent.push(content);
  }
}

function serviceOver(settings: MailGatewaySettings, delivery = new RecordingDelivery()) {
  return MailDeliveryService.create({ settings: () => Promise.resolve(settings), delivery });
}

describe("MailDeliveryService", () => {
  describe("when a module sends to undisclosed recipients with an unsubscribe link", () => {
    it("hands the gateway blind copies and RFC 8058's one-click pair, as main wrote them", async () => {
      const delivery = new RecordingDelivery();

      await serviceOver(settingsWith(), delivery).sendEmail({
        to: "LangWatch Triggers <no-reply+tag@langwatch.ai>",
        undisclosedRecipients: ["ada@example.com"],
        subject: "Errors above threshold",
        html: "<p>hi</p>",
        unsubscribe: { url: "https://app.langwatch.test/api/unsubscribe?token=t" },
      });

      expect(delivery.sent).toEqual([
        {
          to: "LangWatch Triggers <no-reply+tag@langwatch.ai>",
          bcc: ["ada@example.com"],
          subject: "Errors above threshold",
          html: "<p>hi</p>",
          headers: {
            "List-Unsubscribe": "<https://app.langwatch.test/api/unsubscribe?token=t>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
      ]);
    });
  });

  describe("when the public config asks it, with EMAIL_PROVIDER unset and only a SendGrid credential", () => {
    it("projects email on from the member's own answer", async () => {
      const member = serviceOver(settingsWith({ sendgrid: { apiKey: "SG.test" } }));

      await expect(
        notificationBrowserConfig.project(config, { getMailDelivery: () => member.getView() }),
      ).resolves.toEqual({ email: true });
    });
  });

  describe("when EMAIL_PROVIDER names SMTP and a relay is set", () => {
    it("names the gateway and says SMTP is configured", async () => {
      const view = await serviceOver(
        settingsWith({ provider: "smtp", smtp: { host: "mail.acme.test" } }),
      ).getView();

      expect(view).toEqual({ provider: "smtp", smtpConfigured: true, misconfigured: false });
    });
  });

  describe("when nothing is configured", () => {
    it("names no gateway", async () => {
      await expect(serviceOver(settingsWith()).getView()).resolves.toEqual({
        smtpConfigured: false,
        misconfigured: false,
      });
    });
  });

  describe("when EMAIL_PROVIDER names a gateway whose settings are missing", () => {
    /** @scenario "A misconfigured email provider keeps sign-up on the mailed link" */
    it("reads as no gateway rather than failing the checkup, and says it is misconfigured", async () => {
      await expect(serviceOver(settingsWith({ provider: "resend" })).getView()).resolves.toEqual({
        smtpConfigured: false,
        misconfigured: true,
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
