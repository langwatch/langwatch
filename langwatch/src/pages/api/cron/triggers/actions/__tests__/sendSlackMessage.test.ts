import { TriggerAction, type AlertType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleSendSlackMessage } from "../sendSlackMessage";

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { captureException } from "~/utils/posthogErrorCapture";

describe("handleSendSlackMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when slack message is sent successfully", () => {
    it("calls sendSlackWebhook with correct parameters", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: {
            slackWebhook: "https://hooks.slack.com/test-webhook",
          },
          alertType: "WARNING" as AlertType,
          message: "Custom slack message",
        } as any,
        projects: [],
        triggerData: [
          {
            input: "test input",
            output: "test output",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleSendSlackMessage(context);

      expect(sendSlackWebhook).toHaveBeenCalledWith({
        triggerWebhook: "https://hooks.slack.com/test-webhook",
        triggerData: context.triggerData,
        triggerName: "Test Trigger",
        projectSlug: "test-project",
        triggerType: "WARNING",
        triggerMessage: "Custom slack message",
      });
    });
  });

  describe("when action params has no slackWebhook", () => {
    it("sends webhook with empty string URL", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: {},
          alertType: null,
          message: "",
        } as any,
        projects: [],
        triggerData: [],
        projectSlug: "test-project",
      };

      await handleSendSlackMessage(context);

      expect(sendSlackWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerWebhook: "",
        }),
      );
    });
  });

  describe("when sendSlackWebhook throws an error", () => {
    it("captures the exception with full context", async () => {
      const error = new Error("Slack webhook failed");
      vi.mocked(sendSlackWebhook).mockRejectedValue(error);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: { slackWebhook: "https://hooks.slack.com/test" },
        } as any,
        projects: [],
        triggerData: [],
        projectSlug: "test-project",
      };

      await handleSendSlackMessage(context);

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

