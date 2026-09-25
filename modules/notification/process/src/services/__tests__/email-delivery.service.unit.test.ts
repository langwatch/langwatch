import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EmailContent,
  EmailGatewayOpener,
  EmailProviderName,
  MailerConfiguration,
} from "../../channels/email-delivery.channel.ts";
import { emailGatewayOpener } from "../../channels/email-gateway-channels.registry.ts";
import { MemoryEmailGatewayChannel } from "../../channels/memory/memory.email-gateway.channel.ts";
import { EmailDeliveryService } from "../email-delivery.service.ts";

/**
 * Spec: modules/notification/specs/packaged-mail-delivery.feature
 */
const configuration = (overrides: Partial<MailerConfiguration> = {}): MailerConfiguration => ({
  defaultFrom: "LangWatch <contact@langwatch.ai>",
  ses: { enabled: false },
  sendgrid: {},
  smtp: {},
  resend: {},
  ...overrides,
});

const productionGateways = (mailer: MailerConfiguration) =>
  emailGatewayOpener({
    configuration: mailer,
    aws: { build: () => ({ requestHandler: {} }) },
    outboundProxy: {},
  });

const compose = (
  mailer: MailerConfiguration,
  openGateway: EmailGatewayOpener = () => {
    throw new Error("no gateway scripted");
  },
) => EmailDeliveryService.create({ configuration: mailer, openGateway });

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
      ],
      [
        "sendgrid" as const,
        configuration({ provider: "sendgrid", sendgrid: { apiKey: "SG.test" } }),
      ],
      [
        "smtp" as const,
        configuration({ provider: "smtp", smtp: { url: "smtp://localhost:1025" } }),
      ],
      ["resend" as const, configuration({ provider: "resend", resend: { apiKey: "re_test" } })],
    ])("sends both through one %s transport", async (name, mailer) => {
      const gateway = MemoryEmailGatewayChannel.create(name);
      const create = vi.fn((_name: EmailProviderName) => gateway);

      const delivery = compose(mailer, create);
      await delivery.send(message());
      await delivery.send(message());

      expect(create).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(name);
      expect(gateway.sent).toHaveLength(2);
      expect(delivery.defaultFrom()).toBe("LangWatch <contact@langwatch.ai>");
    });
  });
});

describe("given a mailer configuration naming a provider whose credentials are absent", () => {
  describe("when the delivery capability sends", () => {
    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("refuses without reaching another configured gateway", async () => {
      const mailer = configuration({ provider: "resend", sendgrid: { apiKey: "SG.test" } });
      const production = productionGateways(mailer);
      const opened: EmailProviderName[] = [];
      const delivery = compose(mailer, (name) => {
        opened.push(name);
        return production(name);
      });
      await expect(delivery.send(message())).rejects.toThrow(/RESEND_API_KEY/);
      expect(opened).toEqual([]);
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
      const gateway = MemoryEmailGatewayChannel.create("smtp");
      const delivery = compose(
        configuration({ provider: "smtp", smtp: { url: "smtp://localhost:1025" } }),
        () => gateway,
      );
      await delivery.send(message());
      await delivery.close();
      await delivery.close();

      expect(gateway.closeCalls).toBe(1);
      await expect(delivery.send(message())).rejects.toThrow("Mailer runtime is closed.");
    });
  });
});
