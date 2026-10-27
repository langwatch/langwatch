import { AlertType } from "@langwatch/automation-contract";
import { describe, expect, it, vi } from "vitest";

import type { AutomationNotificationDelivery } from "../../channels/automation-notification-delivery.channel.ts";
import { AutomationTemplateService } from "../automation-template.service.ts";
import { AutomationTestFireService } from "../automation-test-fire.service.ts";

function serviceOver({ provider }: { provider: string | undefined }) {
  const sendEmail = vi.fn(async () => undefined);
  const mail = {
    sendEmail,
    getMailDelivery: async () => ({
      provider,
      smtpConfigured: false,
      smtpSendsCredentials: false,
      misconfigured: false,
    }),
  };
  const unused = vi.fn(async () => {
    throw new Error("an email test fire reaches no other transport");
  });
  const delivery: Pick<AutomationNotificationDelivery, "sendSlackWebhook" | "sendSlackBot"> = {
    sendSlackWebhook: unused,
    sendSlackBot: unused,
  };
  const service = AutomationTemplateService.create({
    baseHost: "https://app.langwatch.ai",
    delivery: AutomationTestFireService.create({
      mail,
      delivery,
      webhooks: { sendRequest: unused },
    }),
  });

  return { service, sendEmail };
}

const emailTestFire = () => ({
  channel: "email" as const,
  trigger: { name: "High latency", alertType: AlertType.WARNING },
  project: { name: "Acme", slug: "acme" },
  draft: {},
  recipients: ["author@acme.test"],
  webhook: null,
});

describe("an email test fire", () => {
  describe("given an installation with no email provider", () => {
    /** @scenario "An email test on an installation without email says email is not set up" */
    it("is refused with email_provider_not_configured and sends nothing", async () => {
      const { service, sendEmail } = serviceOver({ provider: undefined });

      await expect(service.testFire(emailTestFire())).rejects.toMatchObject({
        code: "email_provider_not_configured",
        message: expect.stringMatching(/no email provider is configured/i),
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe("given an installation with an email provider", () => {
    it("sends the rendered test email to the author through notification", async () => {
      const { service, sendEmail } = serviceOver({ provider: "smtp" });

      await service.testFire(emailTestFire());

      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["author@acme.test"] }));
    });
  });
});
