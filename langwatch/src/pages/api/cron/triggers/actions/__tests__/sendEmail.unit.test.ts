import { type AlertType, TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "../../types";
import { handleSendEmail } from "../sendEmail";

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
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
const isSendClaimed = vi.fn().mockResolvedValue(false);
const claimSend = vi.fn().mockResolvedValue(true);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    emailSuppressions: { filterSuppressed },
    // FIX 4: the cron path backs the mailer's per-recipient idempotency gate
    // with the same TriggerSent claim store the outbox path uses, reached via
    // getApp().triggers — so a mid-loop failure doesn't re-send on the next tick.
    triggers: { isSendClaimed, claimSend },
  }),
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
        // FIX 4: per-recipient idempotency callbacks, wired like the outbox path.
        isRecipientSent: expect.any(Function),
        recordRecipientSent: expect.any(Function),
      });
    });
  });

  describe("when the per-recipient idempotency callbacks are passed to the mailer", () => {
    it("backs them with the TriggerSent claim store under a rcpt:-prefixed key", async () => {
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
        triggerData: [
          {
            input: "i",
            output: "o",
            traceId: "trace-1",
            projectId: "project-1",
            fullTrace: {} as any,
          },
        ],
        projectSlug: "test-project",
      };

      await handleSendEmail(context);

      const args = vi.mocked(sendTriggerEmail).mock.calls[0]?.[0];
      // Invoke the wired callbacks the way the mailer would and assert they
      // delegate to getApp().triggers with the rcpt:-prefixed dedup key.
      await args!.isRecipientSent!("deadbeefdeadbeef");
      await args!.recordRecipientSent!("deadbeefdeadbeef");

      expect(isSendClaimed).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        projectId: "project-1",
        traceId: expect.stringMatching(/^rcpt:[0-9a-f]{16}:deadbeefdeadbeef$/),
      });
      const readKey = isSendClaimed.mock.calls[0]?.[0];
      const writeKey = claimSend.mock.calls[0]?.[0];
      // Read and write must target the SAME key, or a retry would never see
      // the recorded delivery.
      expect(writeKey).toEqual(readKey);
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
