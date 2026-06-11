import { AlertType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerData } from "~/pages/api/cron/triggers/types";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { Trace } from "~/server/tracer/types";

const { sendEmailMock, computeDefaultFromMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  computeDefaultFromMock: vi.fn(() => "LangWatch <contact@langwatch.ai>"),
}));

vi.mock("../emailSender", () => ({
  sendEmail: sendEmailMock,
  computeDefaultFrom: computeDefaultFromMock,
}));

import { sendTriggerEmail } from "../triggerEmail";
import { TEST_FIRE_TRIGGER_ID_SENTINEL } from "../triggerNoReply";

const triggerData: TriggerData[] = [
  {
    input: "in",
    output: "out",
    traceId: "trace-1",
    projectId: "project-1",
    fullTrace: { trace_id: "trace-1" } as unknown as Trace,
  },
];

function callEmail(overrides?: { triggerId?: string }) {
  return sendTriggerEmail({
    triggerEmails: ["user@example.com", "other@example.com"],
    triggerData,
    triggerName: "Quality Alert",
    triggerId: overrides?.triggerId ?? "trigger_test123",
    projectId: "project-1",
    projectSlug: "demo",
    triggerType: AlertType.WARNING,
    triggerMessage: "",
  });
}

describe("sendTriggerEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the provider accepts the send", () => {
    it("returns without raising", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await expect(callEmail()).resolves.toBeUndefined();
    });

    it("sends one envelope per recipient with a hashed no-reply To", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();
      expect(sendEmailMock).toHaveBeenCalledTimes(2);
      const recipients = sendEmailMock.mock.calls.map(
        (c) => (c[0] as { bcc: string[] }).bcc,
      );
      expect(recipients).toEqual([["user@example.com"], ["other@example.com"]]);
      for (const call of sendEmailMock.mock.calls) {
        const args = call[0] as { to: string };
        expect(args.to).toMatch(
          /^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/,
        );
      }
    });

    it("appends an unsubscribe footer and one-click headers per recipient", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();
      const args = sendEmailMock.mock.calls[0]![0] as {
        html: string;
        headers: Record<string, string>;
      };
      expect(args.html).toContain("Stop receiving this notification");
      expect(args.html).toContain("Stop all notifications from this project");
      expect(args.html).toContain("/unsubscribe?token=");
      expect(args.headers["List-Unsubscribe"]).toMatch(/^<.*\/unsubscribe\?token=/);
      expect(args.headers["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
    });

    it("skips the unsubscribe footer for the test-fire sentinel", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail({ triggerId: TEST_FIRE_TRIGGER_ID_SENTINEL });
      const args = sendEmailMock.mock.calls[0]![0] as {
        html: string;
        headers?: Record<string, string>;
      };
      expect(args.html).not.toContain("/unsubscribe?token=");
      expect(args.headers).toBeUndefined();
    });
  });

  describe("when the provider throttles the send", () => {
    it("raises a retryable DispatchError", async () => {
      sendEmailMock.mockRejectedValue({ $metadata: { httpStatusCode: 500 } });
      const err = await callEmail().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });

  describe("when the provider rejects the address", () => {
    it("raises a non-retryable DispatchError", async () => {
      sendEmailMock.mockRejectedValue({ $metadata: { httpStatusCode: 400 } });
      const err = await callEmail().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
    });
  });
});
