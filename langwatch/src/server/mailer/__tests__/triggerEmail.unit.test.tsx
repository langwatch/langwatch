import { AlertType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerData } from "~/pages/api/cron/triggers/types";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { Trace } from "~/server/tracer/types";

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }));

vi.mock("../emailSender", () => ({ sendEmail: sendEmailMock }));

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
    triggerEmails: ["user@example.com"],
    triggerData,
    triggerName: "Quality Alert",
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
  });

  describe("when the provider throttles the send", () => {
    it("raises a retryable DispatchError", async () => {
      sendEmailMock.mockRejectedValue({ $metadata: { httpStatusCode: 429 } });
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
