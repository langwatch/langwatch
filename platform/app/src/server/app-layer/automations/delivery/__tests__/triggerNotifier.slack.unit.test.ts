import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@slack/webhook", () => ({
  IncomingWebhook: class {
    send = sendMock;
  },
}));
vi.mock("~/server/mailer/emailSender", () => ({
  sendEmail: vi.fn(),
  computeDefaultFrom: () => "noreply@langwatch.test",
}));

import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { NotificationDeliveryError } from "../../errors";
import { liveTriggerNotifier } from "../triggerNotifier";

const WEBHOOK = "https://hooks.slack.com/services/T/B/X";

async function testSlack(webhook = WEBHOOK): Promise<DispatchError> {
  const error = await liveTriggerNotifier
    .sendSlack({ webhook, payload: { text: "hello" } })
    .catch((e: unknown) => e);
  if (!(error instanceof DispatchError)) {
    throw new Error("expected the test send to raise a DispatchError");
  }
  return error;
}

function slackRefusal({ status, data }: { status: number; data: string }) {
  return {
    code: "slack_webhook_http_error",
    original: { response: { status, data } },
  };
}

describe("liveTriggerNotifier.sendSlack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when Slack refuses the webhook as revoked or removed", () => {
    /** @scenario "A test to a webhook Slack refuses names the refusal" */
    it.each([
      { status: 403, data: "invalid_token" },
      { status: 404, data: "no_service" },
      { status: 404, data: "" },
    ])("says the webhook no longer works for $status $data", async (refusal) => {
      sendMock.mockRejectedValue(slackRefusal(refusal));
      const error = await testSlack();
      expect(error.customerMessage).toMatch(/no longer accepts this webhook/);
      expect(error.customerMessage).toMatch(/Create a new incoming webhook/);

      const handled = new NotificationDeliveryError(error.message, {
        customerMessage: error.customerMessage,
      });
      expect(handled.code).toBe("notification_delivery_error");
      expect(handled.meta).toMatchObject({
        message: error.customerMessage,
      });
    });
  });

  describe("when the webhook's channel was archived", () => {
    it("names the archived channel", async () => {
      sendMock.mockRejectedValue(
        slackRefusal({ status: 410, data: "channel_is_archived" }),
      );
      const error = await testSlack();
      expect(error.customerMessage).toMatch(/is archived/);
    });
  });

  describe("when Slack cannot be reached", () => {
    /** @scenario "A test that cannot reach Slack says so" */
    it("says Slack could not be reached", async () => {
      sendMock.mockRejectedValue({
        code: "slack_webhook_request_error",
        original: { code: "ENOTFOUND" },
      });
      const error = await testSlack();
      expect(error.customerMessage).toBe(
        "Slack could not be reached. Try again in a moment.",
      );
    });
  });

  describe("when the URL is not a Slack incoming webhook", () => {
    it("refuses without sending and says what the URL must be", async () => {
      const error = await testSlack("https://attacker.example.com/hook");
      expect(sendMock).not.toHaveBeenCalled();
      expect(error.customerMessage).toMatch(/https:\/\/hooks\.slack\.com\//);
    });
  });
});
