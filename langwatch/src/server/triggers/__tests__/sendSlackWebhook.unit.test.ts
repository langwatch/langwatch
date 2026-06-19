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

import {
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "../sendSlackWebhook";

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

function callRendered() {
  return sendRenderedSlackMessage({
    triggerWebhook: "https://hooks.slack.com/services/T/B/X",
    triggerName: "Quality Alert",
    payload: { text: "rendered body" },
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

  describe("when the stored webhook URL is not a genuine hooks.slack.com endpoint", () => {
    const bypassAttempts = [
      "https://attacker.example.com/exfil",
      "https://hooks.slack.com@evil.com/",
      "https://hooks.slack.com.evil.com/",
      "http://hooks.slack.com/x",
      "//hooks.slack.com/",
      "https://hooks.slack.com@evil.com/services/x",
      "https://hooks.slack.com/",
      "https://hooks.slack.com",
    ];

    it.each(
      bypassAttempts,
    )("raises a non-retryable DispatchError without sending for %s", async (triggerWebhook) => {
      const err = await sendSlackWebhook({
        triggerWebhook,
        triggerData: [],
        triggerName: "Quality Alert",
        projectSlug: "demo",
        triggerType: AlertType.WARNING,
        triggerMessage: "",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe("when the webhook scheme is upper-cased but the host is genuine", () => {
    it("dispatches because URL parsing normalizes the scheme and host", async () => {
      // `new URL` lowercases `HTTPS:` -> `https:` and the host, so this is a
      // genuine Slack endpoint and must pass the guard.
      sendMock.mockResolvedValue(undefined);
      await expect(
        sendSlackWebhook({
          triggerWebhook: "HTTPS://hooks.slack.com/services/T/B/X",
          triggerData: [],
          triggerName: "Quality Alert",
          projectSlug: "demo",
          triggerType: AlertType.WARNING,
          triggerMessage: "",
        }),
      ).resolves.toBeUndefined();
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when trace content contains mrkdwn control characters", () => {
    it("escapes &, < and > in the dispatched text", async () => {
      sendMock.mockResolvedValue(undefined);
      await sendSlackWebhook({
        triggerWebhook: "https://hooks.slack.com/services/T/B/X",
        triggerData: [
          {
            traceId: "trace-1",
            input: "<script> & stuff",
            output: "a > b",
            fullTrace: { trace_id: "trace-1", events: [] } as unknown as Trace,
          },
        ],
        triggerName: "Quality Alert",
        projectSlug: "demo",
        triggerType: AlertType.WARNING,
        triggerMessage: "",
      });
      const text = sendMock.mock.calls[0]?.[0]?.text as string;
      expect(text).toContain("&lt;script&gt; &amp; stuff");
      expect(text).toContain("a &gt; b");
      expect(text).not.toContain("<script>");
    });
  });

  describe("when the trigger matches a trace with events", () => {
    it("interpolates the trace link, input/output, and event details into the mrkdwn text", async () => {
      sendMock.mockResolvedValue(undefined);
      await sendSlackWebhook({
        triggerWebhook: "https://hooks.slack.com/services/T/B/X",
        triggerData: [
          {
            traceId: "trace-1",
            input: "user question",
            output: "assistant answer",
            fullTrace: {
              trace_id: "trace-1",
              events: [
                {
                  event_type: "thumbs_up",
                  metrics: { vote: 1 },
                  event_details: { feedback: "great" },
                },
              ],
            } as unknown as Trace,
          },
        ],
        triggerName: "Quality Alert",
        projectSlug: "demo",
        triggerType: AlertType.WARNING,
        triggerMessage: "",
      });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const text = sendMock.mock.calls[0]?.[0]?.text as string;
      expect(text).toContain("⚠️ LangWatch Trigger - *Quality Alert*");
      expect(text).toContain("/demo/messages/trace-1|trace-1>");
      expect(text).toContain("*Input:* user question");
      expect(text).toContain("*Output:* assistant answer");
      expect(text).toContain("*Event Type:* thumbs_up");
      expect(text).toContain("*vote:* 1");
      expect(text).toContain("*feedback:* great");
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

describe("sendRenderedSlackMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the webhook post succeeds", () => {
    it("posts the rendered payload without raising", async () => {
      sendMock.mockResolvedValue(undefined);
      await expect(callRendered()).resolves.toBeUndefined();
      expect(sendMock).toHaveBeenCalledWith({ text: "rendered body" });
    });
  });

  describe("when the webhook is rate limited", () => {
    it("raises a retryable DispatchError", async () => {
      sendMock.mockRejectedValue({
        original: { response: { status: 429 } },
      });
      const err = await callRendered().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(true);
    });
  });

  describe("when the webhook was revoked", () => {
    it("raises a non-retryable DispatchError", async () => {
      sendMock.mockRejectedValue({
        original: { response: { status: 404 } },
      });
      const err = await callRendered().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
    });
  });

  describe("when the stored webhook URL is not a genuine hooks.slack.com endpoint", () => {
    it("raises a non-retryable DispatchError without sending", async () => {
      const err = await sendRenderedSlackMessage({
        triggerWebhook: "https://hooks.slack.com@evil.com/services/x",
        triggerName: "Quality Alert",
        payload: { text: "rendered body" },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});
