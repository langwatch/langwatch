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
  publicBaseUrl: undefined,
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

  describe("when a module sends replyless", () => {
    it("addresses main's no-reply at the sender's domain and blind-copies the recipient", async () => {
      const delivery = new RecordingDelivery();

      await serviceOver(settingsWith(), delivery).sendEmail({
        to: "ada@example.com",
        replyless: { tag: "81d9d46cce00" },
        subject: "Errors above threshold",
        html: "<p>hi</p>",
      });

      expect(delivery.sent).toEqual([
        {
          to: "LangWatch Triggers <no-reply+81d9d46cce00@langwatch.test>",
          bcc: ["ada@example.com"],
          subject: "Errors above threshold",
          html: "<p>hi</p>",
        },
      ]);
    });
  });

  describe("when a module sends replyless from a sender with another domain, or none", () => {
    it("reads the domain off the sender, falling back to langwatch.ai for a bare address", async () => {
      const sentFrom = async (defaultFrom: string) => {
        const delivery = new RecordingDelivery();
        delivery.defaultFrom = () => defaultFrom;
        await serviceOver(settingsWith(), delivery).sendEmail({
          to: "ada@example.com",
          replyless: { tag: "81d9d46cce00" },
          subject: "s",
          html: "h",
        });
        return delivery.sent[0]?.to;
      };

      await expect(sentFrom("Acme <alerts@mail.acme.test>")).resolves.toBe(
        "LangWatch Triggers <no-reply+81d9d46cce00@mail.acme.test>",
      );
      await expect(sentFrom("contact@acme.test")).resolves.toBe(
        "LangWatch Triggers <no-reply+81d9d46cce00@langwatch.ai>",
      );
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

      expect(view).toEqual({
        provider: "smtp",
        smtpConfigured: true,
        smtpSendsCredentials: false,
        misconfigured: false,
      });
    });
  });

  describe("when the SMTP relay may or may not take a login", () => {
    const sendsCredentials = async (smtp: MailGatewaySettings["smtp"]) =>
      (await serviceOver(settingsWith({ provider: "smtp", smtp })).getView()).smtpSendsCredentials;

    it("sends credentials for a connection URL that names a user", async () => {
      await expect(sendsCredentials({ url: "smtps://user:pass@relay.corp:465" })).resolves.toBe(
        true,
      );
    });

    it("sends none for a connection URL with no user, even beside SMTP_USER", async () => {
      await expect(
        sendsCredentials({ url: "smtp://relay.corp:25", user: "ignored" }),
      ).resolves.toBe(false);
    });

    it("follows SMTP_USER for discrete host settings", async () => {
      await expect(sendsCredentials({ host: "relay.corp", user: "mailer" })).resolves.toBe(true);
      await expect(sendsCredentials({ host: "relay.corp" })).resolves.toBe(false);
    });
  });

  describe("when nothing is configured", () => {
    it("names no gateway", async () => {
      await expect(serviceOver(settingsWith()).getView()).resolves.toEqual({
        smtpConfigured: false,
        smtpSendsCredentials: false,
        misconfigured: false,
      });
    });
  });

  describe("when EMAIL_PROVIDER names a gateway whose settings are missing", () => {
    /** @scenario "A misconfigured email provider keeps sign-up on the mailed link" */
    it("reads as no gateway rather than failing the checkup, and says it is misconfigured", async () => {
      await expect(serviceOver(settingsWith({ provider: "resend" })).getView()).resolves.toEqual({
        smtpConfigured: false,
        smtpSendsCredentials: false,
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

describe("the email capability the interface reads", () => {
  const capabilityOf = (settings: MailGatewaySettings) =>
    notificationBrowserConfig.project(config, {
      getMailDelivery: () => serviceOver(settings).getView(),
    });

  describe("when no gateway can be resolved", () => {
    /** @scenario "Email options stay hidden when no gateway is usable" */
    it("reports email as off, so an invitation can only be shared as a link", async () => {
      await expect(capabilityOf(settingsWith())).resolves.toEqual({ email: false });
    });
  });

  describe("when EMAIL_PROVIDER names SMTP and a relay is set", () => {
    /** @scenario "Email options appear once any gateway is usable" */
    it("reports email as on, so an invitation can be sent by email", async () => {
      await expect(
        capabilityOf(settingsWith({ provider: "smtp", smtp: { host: "mail.acme.test" } })),
      ).resolves.toEqual({ email: true });
    });
  });

  describe("when EMAIL_PROVIDER names a gateway missing its credentials", () => {
    /** @scenario "A misconfigured gateway does not break the interface" */
    it("reports email as off rather than failing to answer", async () => {
      await expect(capabilityOf(settingsWith({ provider: "resend" }))).resolves.toEqual({
        email: false,
      });
    });
  });
});

describe("a delivery identity on a send", () => {
  describe("when a module sends with an idempotency key", () => {
    /** @scenario "Resend retries reuse the same provider idempotency key" */
    /** @scenario "SMTP retries preserve the notification message identity" */
    it("hands the gateway the same key, so a retry is recognisable", async () => {
      const delivery = new RecordingDelivery();
      const command = {
        to: "ada@example.com",
        subject: "s",
        html: "h",
        idempotencyKey: "org:join:a",
      };

      await serviceOver(settingsWith(), delivery).sendEmail(command);
      await serviceOver(settingsWith(), delivery).sendEmail(command);

      expect(delivery.sent.map((sent) => sent.idempotencyKey)).toEqual([
        "org:join:a",
        "org:join:a",
      ]);
    });
  });
});
