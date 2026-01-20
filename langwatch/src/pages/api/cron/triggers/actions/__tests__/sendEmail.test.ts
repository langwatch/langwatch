import { type AlertType, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleSendEmail } from "../sendEmail";

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { captureException } from "~/utils/posthogErrorCapture";

describe("handleSendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when email is sent successfully", () => {
    it("calls sendTriggerEmail with correct parameters", async () => {
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: { members: ["user1@example.com", "user2@example.com"] },
          alertType: "CRITICAL" as AlertType,
          message: "Custom alert message",
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

      await handleSendEmail(context);

      expect(sendTriggerEmail).toHaveBeenCalledWith({
        triggerEmails: ["user1@example.com", "user2@example.com"],
        triggerData: context.triggerData,
        triggerName: "Test Trigger",
        projectSlug: "test-project",
        triggerType: "CRITICAL",
        triggerMessage: "Custom alert message",
      });
    });
  });

  describe("when action params has no members", () => {
    it("sends email with empty recipients list", async () => {
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

      await handleSendEmail(context);

      expect(sendTriggerEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerEmails: [],
        }),
      );
    });
  });

  describe("when sendTriggerEmail throws an error", () => {
    it("captures the exception with full context", async () => {
      const error = new Error("Email send failed");
      vi.mocked(sendTriggerEmail).mockRejectedValue(error);

      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: { members: ["user@example.com"] },
        } as any,
        projects: [],
        triggerData: [],
        projectSlug: "test-project",
      };

      await handleSendEmail(context);

      expect(captureException).toHaveBeenCalledWith(error, {
        extra: {
          triggerId: "trigger-1",
          projectId: "project-1",
          action: TriggerAction.SEND_EMAIL,
        },
      });
    });
  });
});
