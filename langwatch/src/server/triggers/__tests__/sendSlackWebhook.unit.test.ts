import { AlertType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { Trace } from "~/server/tracer/types";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@slack/webhook", () => ({
  IncomingWebhook: class {
    send = sendMock;
  },
}));

import { sendSlackWebhook } from "../sendSlackWebhook";

function callSlack() {
  return sendSlackWebhook({
    triggerWebhook: "https://hooks.slack.com/services/T/B/X",
    triggerData: [
      {
        traceId: "trace-1",
        input: "in",
        output: "out",
        fullTrace: { trace_id: "trace-1", events: [] } as unknown as Trace,
      },
    ],
    triggerName: "Quality Alert",
    projectSlug: "demo",
    triggerType: AlertType.WARNING,
    triggerMessage: "",
  });
}

describe("sendSlackWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the webhook post succeeds", () => {
    it("returns without raising", async () => {
      sendMock.mockResolvedValue(undefined);
      await expect(callSlack()).resolves.toBeUndefined();
    });
  });

  describe("when the webhook is rate limited", () => {
    it("raises a retryable DispatchError", async () => {
      sendMock.mockRejectedValue({
        original: { response: { status: 429 } },
      });
      const err = await callSlack().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });

  describe("when the webhook was revoked", () => {
    it("raises a non-retryable DispatchError", async () => {
      sendMock.mockRejectedValue({
        original: { response: { status: 404 } },
      });
      const err = await callSlack().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
    });
  });

  describe("when the post fails with a transport error", () => {
    it("raises a retryable DispatchError by default", async () => {
      sendMock.mockRejectedValue({ code: "ECONNREFUSED" });
      const err = await callSlack().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });
});
