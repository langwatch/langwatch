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

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const filterSuppressed = vi.fn();
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ emailSuppressions: { filterSuppressed } }),
}));

const consumeEmailCapSlot = vi.fn();
vi.mock("~/server/event-sourcing/outbox/emailHourlyCap", () => ({
  consumeEmailCapSlot: (...args: unknown[]) => consumeEmailCapSlot(...args),
}));

import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { captureException } from "~/utils/posthogErrorCapture";

describe("handleSendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing suppressed, under the cap.
    filterSuppressed.mockImplementation(
      async ({ emails }: { emails: string[] }) => emails,
    );
    consumeEmailCapSlot.mockResolvedValue({ allowed: true, count: 1 });
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
        triggerId: "trigger-1",
        projectId: "project-1",
        projectSlug: "test-project",
        triggerType: "CRITICAL",
        triggerMessage: "Custom alert message",
      });
    });
  });

  describe("when action params has no members", () => {
    it("skips the send without consulting the cap", async () => {
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

      expect(sendTriggerEmail).not.toHaveBeenCalled();
      expect(consumeEmailCapSlot).not.toHaveBeenCalled();
    });
  });

  describe("when some recipients are suppressed", () => {
    it("only sends to the surviving recipients", async () => {
      filterSuppressed.mockResolvedValueOnce(["keep@example.com"]);
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: {
            members: ["keep@example.com", "gone@example.com"],
          },
          alertType: null,
          message: "",
        } as any,
        projects: [],
        triggerData: [],
        projectSlug: "test-project",
      };

      await handleSendEmail(context);

      expect(sendTriggerEmail).toHaveBeenCalledWith(
        expect.objectContaining({ triggerEmails: ["keep@example.com"] }),
      );
    });
  });

  describe("when the trigger is over its hourly cap", () => {
    it("drops the dispatch without sending", async () => {
      consumeEmailCapSlot.mockResolvedValueOnce({ allowed: false, count: 101 });
      const context: TriggerContext = {
        trigger: {
          id: "trigger-1",
          projectId: "project-1",
          name: "Test Trigger",
          actionParams: { members: ["user@example.com"] },
          alertType: null,
          message: "",
        } as any,
        projects: [],
        triggerData: [],
        projectSlug: "test-project",
      };

      await handleSendEmail(context);

      expect(sendTriggerEmail).not.toHaveBeenCalled();
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
