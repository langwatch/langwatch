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

const triggerData: TriggerData[] = [
  {
    input: "in",
    output: "out",
    traceId: "trace-1",
    projectId: "project-1",
    fullTrace: { trace_id: "trace-1" } as unknown as Trace,
  },
];

function callEmail() {
  return sendTriggerEmail({
    triggerEmails: ["user@example.com", "other@example.com"],
    triggerData,
    triggerName: "Quality Alert",
    triggerId: "trigger_test123",
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

    it("routes recipients as BCC and uses a hashed no-reply To", async () => {
      sendEmailMock.mockResolvedValue(undefined);
      await callEmail();
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const args = sendEmailMock.mock.calls[0]![0] as {
        to: string;
        bcc: string[];
      };
      expect(args.to).toMatch(/^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/);
      expect(args.bcc).toEqual(["user@example.com", "other@example.com"]);
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
