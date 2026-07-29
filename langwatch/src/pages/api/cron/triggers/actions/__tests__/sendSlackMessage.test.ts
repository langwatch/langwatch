import { type AlertType, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@prisma/client";
import type { TriggerContext } from "../../types";
import { handleSendSlackMessage } from "../sendSlackMessage";

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendRenderedSlackMessage: vi.fn(),
}));

vi.mock("~/server/triggers/slackWebApi", () => ({
  postSlackChatMessage: vi.fn(),
}));

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendRenderedTriggerEmail: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

const filterSuppressed = vi.fn(
  async ({ emails }: { emails: string[] }) => emails,
);
const isSendClaimed = vi.fn().mockResolvedValue(false);
const claimSend = vi.fn().mockResolvedValue(true);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    emailSuppressions: { filterSuppressed },
    triggers: { isSendClaimed, claimSend },
  }),
}));

// The stored bot token is AES-encrypted at rest; the cron must decrypt it with
// the same helper the event-sourced path uses.
vi.mock("~/automations/providers/definitions/slack/secret", () => ({
  decryptSlackBotToken: vi.fn(
    ({ slackBotToken }: { slackBotToken?: string }) =>
      slackBotToken ? `decrypted:${slackBotToken}` : null,
  ),
}));

import { sendRenderedSlackMessage } from "~/server/triggers/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/triggers/slackWebApi";
import { captureException } from "~/utils/posthogErrorCapture";

const PROJECT: Project = {
  id: "project-1",
  name: "Demo",
  slug: "test-project",
} as unknown as Project;

function makeContext(actionParams: Record<string, unknown>): TriggerContext {
  return {
    trigger: {
      id: "trigger-1",
      projectId: "project-1",
      name: "Test Trigger",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      actionParams,
      alertType: "WARNING" as AlertType,
      message: "Custom slack message",
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    } as any,
    projects: [PROJECT],
    triggerData: [],
    projectSlug: "test-project",
    graphAlert: {
      graph: { id: "graph-1", name: "Latency p95" },
      metric: { label: "Latency p95", seriesName: "0/duration/p95" },
      condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
      currentValue: 712,
      window: {
        start: new Date("2026-06-21T09:00:00Z"),
        end: new Date("2026-06-21T10:00:00Z"),
      },
      occurredAt: new Date("2026-06-21T10:00:00Z"),
      previousFireId: null,
    },
  };
}

describe("handleSendSlackMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSendClaimed.mockResolvedValue(false);
    claimSend.mockResolvedValue(true);
  });

  describe("when the automation delivers through a webhook", () => {
    it("reports the fire as consumed (didSend true)", async () => {
      const result = await handleSendSlackMessage(
        makeContext({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/test-webhook",
        }),
      );

      expect(result).toEqual({ didSend: true });
    });

    it("posts the rendered alert to the configured webhook", async () => {
      await handleSendSlackMessage(
        makeContext({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/test-webhook",
        }),
      );

      expect(postSlackChatMessage).not.toHaveBeenCalled();
      expect(sendRenderedSlackMessage).toHaveBeenCalledTimes(1);
      const call = vi.mocked(sendRenderedSlackMessage).mock.calls[0]?.[0] as {
        triggerWebhook: string;
        triggerName: string;
        payload: { text: string };
      };
      expect(call.triggerWebhook).toBe("https://hooks.slack.com/test-webhook");
      expect(call.triggerName).toBe("Test Trigger");
      // Rendered from the ALERT defaults — metric-crossed-threshold language,
      // not the legacy trace-shaped builder.
      expect(call.payload.text).toContain("Latency p95");
      expect(call.payload.text).toContain("712");
    });
  });

  // Regression (dispatch5015-P0, Finding 1): the Slack config seeds
  // `deliveryMethod: "bot"` for every new automation, and with the firing flag
  // OFF (the shipped default) the cron is the ONLY dispatcher. It could only
  // POST to `actionParams.slackWebhook` — which a bot automation does not have —
  // so it called the webhook sender with "", swallowed the throw, and the caller
  // still recorded the incident. Nothing was ever sent, and it never retried.
  describe("when the automation delivers through a bot connection", () => {
    it("decrypts the stored token and posts through the Slack Web API", async () => {
      await handleSendSlackMessage(
        makeContext({
          slackDelivery: "bot",
          slackBotToken: "ciphertext",
          slackChannelId: "C123",
        }),
      );

      expect(sendRenderedSlackMessage).not.toHaveBeenCalled();
      expect(postSlackChatMessage).toHaveBeenCalledTimes(1);
      const call = vi.mocked(postSlackChatMessage).mock.calls[0]?.[0] as {
        token: string;
        channel: string;
        payload: unknown;
      };
      expect(call.token).toBe("decrypted:ciphertext");
      expect(call.channel).toBe("C123");
      expect(call.payload).toBeTruthy();
    });

    it("records the post so a cron re-tick does not re-notify the channel", async () => {
      await handleSendSlackMessage(
        makeContext({
          slackDelivery: "bot",
          slackBotToken: "ciphertext",
          slackChannelId: "C123",
        }),
      );

      expect(claimSend).toHaveBeenCalledTimes(1);
      const claimed = claimSend.mock.calls[0]?.[0] as { traceId: string };
      expect(claimed.traceId).toMatch(/^rcpt:[0-9a-f]{16}:[0-9a-f]{16}$/);
    });

    describe("when the channel was already posted to for this fire", () => {
      it("does not post again", async () => {
        isSendClaimed.mockResolvedValue(true);

        await handleSendSlackMessage(
          makeContext({
            slackDelivery: "bot",
            slackBotToken: "ciphertext",
            slackChannelId: "C123",
          }),
        );

        expect(postSlackChatMessage).not.toHaveBeenCalled();
      });
    });

    describe("when the bot connection is missing its channel", () => {
      it("captures the failure and reports didSend false instead of silently posting nothing", async () => {
        const result = await handleSendSlackMessage(
          makeContext({ slackDelivery: "bot", slackBotToken: "ciphertext" }),
        );

        // Nothing was delivered: the caller must not open the incident, or
        // the alert would read "firing" while never having notified anyone.
        expect(result).toEqual({ didSend: false });
        expect(postSlackChatMessage).not.toHaveBeenCalled();
        expect(sendRenderedSlackMessage).not.toHaveBeenCalled();
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining("missing its token or channel"),
          }),
          {
            extra: {
              triggerId: "trigger-1",
              projectId: "project-1",
              action: TriggerAction.SEND_SLACK_MESSAGE,
            },
          },
        );
      });
    });
  });

  describe("when the Slack send throws", () => {
    it("captures the exception and reports didSend false so the caller does not record the incident", async () => {
      const error = new Error("Slack webhook failed");
      vi.mocked(sendRenderedSlackMessage).mockRejectedValue(error);

      const result = await handleSendSlackMessage(
        makeContext({
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/test",
        }),
      );

      expect(result).toEqual({ didSend: false });
      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          action: TriggerAction.SEND_SLACK_MESSAGE,
        },
      });
    });
  });
});
