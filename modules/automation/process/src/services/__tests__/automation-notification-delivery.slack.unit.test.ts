/**
 * A Slack webhook refusal reaches the author as prose.
 * @see specs/automations/slack-delivery.feature
 */
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { AutomationNotificationDeliveryService } from "../automation-notification-delivery.service.ts";

const WEBHOOK = "https://hooks.slack.com/services/T/B/X";

function deliveryRefusedWith(refusal: unknown) {
  const sent: string[] = [];
  const delivery = AutomationNotificationDeliveryService.create({
    mailer: { sendEmail: async () => {} },
    renderer: ReactEmailMailRenderer.create(),
    baseHost: "https://app.langwatch.test",
    slackWebhookClient: {
      send: async ({ webhook }: { webhook: string }) => {
        sent.push(webhook);
        throw refusal;
      },
    },
  });
  return { delivery, sent };
}

function slackRefusal({ status, data }: { status: number; data: string }) {
  return { code: "slack_webhook_http_error", original: { response: { status, data } } };
}

async function customerMessageOf({
  refusal,
  webhook = WEBHOOK,
}: {
  refusal: unknown;
  webhook?: string;
}) {
  const { delivery, sent } = deliveryRefusedWith(refusal);
  const error: unknown = await delivery
    .sendSlackWebhook({ webhook, triggerName: "test fire", payload: { text: "hello" } })
    .catch((caught: unknown) => caught);
  expect(error).toMatchObject({ name: "DispatchError" });
  return { error, sent };
}

describe("AutomationNotificationDeliveryService.sendSlackWebhook", () => {
  describe("when Slack refuses the webhook as revoked or removed", () => {
    /** @scenario "A test to a webhook Slack refuses names the refusal" */
    it.each([
      { status: 403, data: "invalid_token" },
      { status: 404, data: "no_service" },
      { status: 404, data: "" },
    ])("says the webhook no longer works for $status $data", async (refusal) => {
      const { error } = await customerMessageOf({ refusal: slackRefusal(refusal) });

      expect(error).toMatchObject({
        customerMessage: expect.stringMatching(
          /no longer accepts this webhook.*Create a new incoming webhook/,
        ),
      });
    });
  });

  describe("when the webhook's channel was archived", () => {
    it("names the archived channel", async () => {
      const { error } = await customerMessageOf({
        refusal: slackRefusal({ status: 410, data: "channel_is_archived" }),
      });

      expect(error).toMatchObject({ customerMessage: expect.stringMatching(/is archived/) });
    });
  });

  describe("when Slack cannot be reached", () => {
    /** @scenario "A test that cannot reach Slack says so" */
    it("says Slack could not be reached", async () => {
      const { error } = await customerMessageOf({
        refusal: { code: "slack_webhook_request_error", original: { code: "ENOTFOUND" } },
      });

      expect(error).toMatchObject({
        customerMessage: "Slack could not be reached. Try again in a moment.",
      });
    });
  });

  describe("when the URL is not a Slack incoming webhook", () => {
    it("refuses without sending and says what the URL must be", async () => {
      const { error, sent } = await customerMessageOf({
        refusal: new Error("unreachable"),
        webhook: "https://attacker.example.com/hook",
      });

      expect(sent).toEqual([]);
      expect(error).toMatchObject({
        customerMessage: expect.stringMatching(/https:\/\/hooks\.slack\.com\//),
      });
    });
  });
});
