import { AlertType, type TestFireWebhookDestination } from "@langwatch/automation-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import { ApiAutomationTestFire } from "../../app/automation-composition.build.ts";
import type { AutomationNotificationDelivery } from "../../channels/automation-notification-delivery.channel.ts";
import { AutomationTemplateService } from "../automation-template.service.ts";

type SendRequest = WebhookApi["sendRequest"];

function testFireOverWebhooks() {
  const send = vi.fn<SendRequest>(async () => ({ status: 202, dispatchId: "evt_test" }));
  const unused = vi.fn(async () => {
    throw new Error("a webhook test fire reaches no other transport");
  });
  const delivery: Pick<AutomationNotificationDelivery, "sendSlackWebhook" | "sendSlackBot"> = {
    sendSlackWebhook: unused,
    sendSlackBot: unused,
  };
  const service = AutomationTemplateService.create({
    baseHost: "https://app.langwatch.ai",
    delivery: ApiAutomationTestFire.create({
      mail: { sendEmail: unused, getMailDelivery: unused },
      delivery,
      webhooks: { sendRequest: send },
    }),
  });
  const fire = (webhookDestination: TestFireWebhookDestination) =>
    service.testFire({
      channel: "webhook",
      trigger: { name: "High latency", alertType: AlertType.WARNING },
      project: { name: "Acme", slug: "acme" },
      draft: {},
      recipients: [],
      webhook: null,
      webhookDestination,
    });

  return { fire, send };
}

const DESTINATION = {
  url: "https://receiver.acme.test/hook",
  method: "POST",
  headers: {},
  bodyTemplate: null,
} satisfies TestFireWebhookDestination;

describe("webhook test fire", () => {
  describe("given the automation declares a plain-text Content-Type", () => {
    it("posts the rendered text announced as the declared type", async () => {
      const { fire, send } = testFireOverWebhooks();

      await fire({
        ...DESTINATION,
        bodyTemplate: "fired {{ trigger.name }}",
        contentType: "text/plain; charset=utf-8",
      });

      expect(send.mock.calls[0]?.[0]).toMatchObject({
        body: "fired High latency",
        contentType: "text/plain; charset=utf-8",
      });
    });
  });

  describe("given an automation saved before content types existed", () => {
    /** @scenario "An automation saved before content types existed still sends JSON" */
    it("posts JSON, announced exactly as it always was", async () => {
      const { fire, send } = testFireOverWebhooks();

      await fire(DESTINATION);

      const request = send.mock.calls[0]?.[0];
      expect(request?.contentType).toBe("application/json");
      expect(() => JSON.parse(request?.body ?? "")).not.toThrow();
    });
  });

  describe("when the author presses Send a test", () => {
    /** @scenario "A test fire sends the rendered request to the configured endpoint" */
    it("posts to the configured URL with the test-fire marker and answers its status", async () => {
      const { fire, send } = testFireOverWebhooks();

      const result = await fire(DESTINATION);

      expect(send.mock.calls[0]?.[0]).toMatchObject({ url: DESTINATION.url, testFire: true });
      expect(result.httpStatus).toBe(202);
    });
  });
});
