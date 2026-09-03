import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailGatewayPort,
  type EmailContent,
  type EmailProviderName,
  type MailerConfiguration,
} from "../../ports/email-delivery.port";
import { EmailDeliveryAdapter } from "../email-delivery.adapter";
import { ResendEmailGatewayAdapter } from "../resend.email-gateway.adapter";
import { SendgridEmailGatewayAdapter } from "../sendgrid.email-gateway.adapter";
import { SesEmailGatewayAdapter } from "../ses.email-gateway.adapter";
import { SmtpEmailGatewayAdapter } from "../smtp.email-gateway.adapter";

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
class RecordingGateway extends EmailGatewayPort {
  readonly sent: EmailContent[] = [];
  closeCalls = 0;

  constructor(readonly name: EmailProviderName) {
    super();
  }

  async send({ content }: { content: EmailContent; defaultFrom: string }) {
    this.sent.push(content);
    return { accepted: true };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

const configuration = (overrides: Partial<MailerConfiguration> = {}): MailerConfiguration => ({
  defaultFrom: "LangWatch <contact@langwatch.ai>",
  ses: { enabled: false },
  sendgrid: {},
  smtp: {},
  resend: {},
  ...overrides,
});

const compose = (mailer: MailerConfiguration) =>
  EmailDeliveryAdapter.create({
    configuration: mailer,
    aws: { build: () => ({ requestHandler: {} }) },
    outboundProxy: {},
  });

const message = (): EmailContent => ({
  to: "admin@acme.example",
  subject: "Alert",
  html: "<p>Alert</p>",
});

describe("given a mailer configuration naming one provider", () => {
  beforeEach(() => vi.restoreAllMocks());

  describe("when the delivery capability sends twice", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    it.each([
      [
        "ses" as const,
        configuration({ provider: "ses", ses: { enabled: true, region: "eu-central-1" } }),
        SesEmailGatewayAdapter,
      ],
      [
        "sendgrid" as const,
        configuration({ provider: "sendgrid", sendgrid: { apiKey: "SG.test" } }),
        SendgridEmailGatewayAdapter,
      ],
      [
        "smtp" as const,
        configuration({ provider: "smtp", smtp: { url: "smtp://localhost:1025" } }),
        SmtpEmailGatewayAdapter,
      ],
      [
        "resend" as const,
        configuration({ provider: "resend", resend: { apiKey: "re_test" } }),
        ResendEmailGatewayAdapter,
      ],
    ])("sends both through one %s transport", async (name, mailer, adapter) => {
      const gateway = new RecordingGateway(name);
      const create = vi
        .spyOn(adapter as unknown as { create: () => EmailGatewayPort }, "create")
        .mockReturnValue(gateway);

      const delivery = compose(mailer);
      await delivery.send(message());
      await delivery.send(message());

      expect(create).toHaveBeenCalledOnce();
      expect(gateway.sent).toHaveLength(2);
      expect(delivery.defaultFrom()).toBe("LangWatch <contact@langwatch.ai>");
    });
  });
});

describe("given a mailer configuration naming a provider whose credentials are absent", () => {
  describe("when the delivery capability sends", () => {
    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("refuses without reaching another configured gateway", async () => {
      const sendgrid = vi.spyOn(SendgridEmailGatewayAdapter, "create");
      const delivery = compose(
        configuration({ provider: "resend", sendgrid: { apiKey: "SG.test" } }),
      );
      await expect(delivery.send(message())).rejects.toThrow(/RESEND_API_KEY/);
      expect(sendgrid).not.toHaveBeenCalled();
    });
  });
});

describe("given a mailer configuration with no provider settings at all", () => {
  describe("when the delivery capability is composed", () => {
    /** @scenario "A deployment with no provider composes and fails only at send time" */
    it("composes, and fails only at send time", async () => {
      const delivery = compose(configuration());
      expect(delivery.defaultFrom()).toBe("LangWatch <contact@langwatch.ai>");
      await expect(delivery.send(message())).rejects.toThrow(
        "No email sending method available. Skipping email sending.",
      );
    });
  });
});

describe("given a delivery capability that has sent a message", () => {
  describe("when it is closed twice", () => {
    /** @scenario "Closing the capability releases the transport once" */
    it("releases the gateway once and refuses a later send", async () => {
      const gateway = new RecordingGateway("smtp");
      vi.spyOn(
        SmtpEmailGatewayAdapter as unknown as { create: () => EmailGatewayPort },
        "create",
      ).mockReturnValue(gateway);

      const delivery = compose(
        configuration({ provider: "smtp", smtp: { url: "smtp://localhost:1025" } }),
      );
      await delivery.send(message());
      await delivery.close();
      await delivery.close();

      expect(gateway.closeCalls).toBe(1);
      await expect(delivery.send(message())).rejects.toThrow("Mailer runtime is closed.");
    });
  });
});
