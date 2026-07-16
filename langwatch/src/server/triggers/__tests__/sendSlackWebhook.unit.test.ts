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
  MAX_TEXT_BYTES,
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "../sendSlackWebhook";

const dispatchedText = (): string =>
  sendMock.mock.calls[0]?.[0]?.text as string;

/** One trace carrying the given events, shaped like the trigger pipeline's. */
function traceWith({
  traceId,
  input = "in",
  output = "out",
  events = [],
}: {
  traceId: string;
  input?: string;
  output?: string;
  events?: unknown[];
}) {
  return {
    traceId,
    input,
    output,
    fullTrace: { trace_id: traceId, events } as unknown as Trace,
  };
}

function sendWithTraces(triggerData: ReturnType<typeof traceWith>[]) {
  return sendSlackWebhook({
    triggerWebhook: "https://hooks.slack.com/services/T/B/X",
    triggerData,
    triggerName: "Quality Alert",
    projectSlug: "demo",
    triggerType: AlertType.WARNING,
    triggerMessage: "",
  });
}

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
    it("raises a non-retryable DispatchError naming the HTTP status", async () => {
      sendMock.mockRejectedValue({
        original: { response: { status: 404 } },
      });
      const err = await callSlack().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DispatchError);
      expect((err as DispatchError).retryable).toBe(false);
      expect((err as DispatchError).message).toContain("HTTP 404");
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
      expect(text).toContain("/demo/traces/trace-1|trace-1>");
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

  describe("when trace content exceeds the per-field limit", () => {
    it("truncates input, output, and event values with an ellipsis instead of interpolating them whole", async () => {
      sendMock.mockResolvedValue(undefined);
      const hugeInput = "i".repeat(5000);
      const hugeOutput = "o".repeat(5000);
      const hugeDetail = "d".repeat(5000);
      await sendSlackWebhook({
        triggerWebhook: "https://hooks.slack.com/services/T/B/X",
        triggerData: [
          {
            traceId: "trace-1",
            input: hugeInput,
            output: hugeOutput,
            fullTrace: {
              trace_id: "trace-1",
              events: [
                {
                  event_type: "thumbs_up",
                  metrics: {},
                  event_details: { feedback: hugeDetail },
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

      const text = sendMock.mock.calls[0]?.[0]?.text as string;
      expect(text).not.toContain(hugeInput);
      expect(text).not.toContain(hugeOutput);
      expect(text).not.toContain(hugeDetail);
      expect(text).toContain("i".repeat(500) + "…");
      expect(text).toContain("o".repeat(500) + "…");
      expect(text).toContain("d".repeat(500) + "…");
    });

    it("leaves short content untouched", async () => {
      sendMock.mockResolvedValue(undefined);
      await callSlack();
      const text = sendMock.mock.calls[0]?.[0]?.text as string;
      expect(text).toContain("*Input:* in");
      expect(text).not.toContain("in…");
    });
  });

  describe("when escaping inflates content past the per-field caps", () => {
    it("keeps the dispatched payload within the byte budget", async () => {
      sendMock.mockResolvedValue(undefined);
      // Each field caps at 500 chars, but every `&` escapes to 5 chars, so ten
      // traces of input+output alone reach ~50KB post-escape — the exact shape
      // Slack rejects with a terminal 400.
      const escapeHeavy = "&".repeat(500);
      await sendWithTraces(
        Array.from({ length: 10 }, (_, i) =>
          traceWith({
            traceId: `trace-${i}`,
            input: escapeHeavy,
            output: escapeHeavy,
          }),
        ),
      );

      const text = dispatchedText();
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
        MAX_TEXT_BYTES,
      );
      expect(text).toContain("[truncated]");
    });

    it("bounds a payload made of mixed mrkdwn control characters", async () => {
      sendMock.mockResolvedValue(undefined);
      const escapeHeavy = "<&>".repeat(200);
      await sendWithTraces(
        Array.from({ length: 10 }, (_, i) =>
          traceWith({
            traceId: `trace-${i}`,
            input: escapeHeavy,
            output: escapeHeavy,
            events: Array.from({ length: 20 }, (_, e) => ({
              event_type: `evt-${e}`,
              metrics: Object.fromEntries(
                Array.from({ length: 30 }, (_, m) => [`m${m}`, m]),
              ),
              event_details: Object.fromEntries(
                Array.from({ length: 30 }, (_, d) => [`d${d}`, escapeHeavy]),
              ),
            })),
          }),
        ),
      );

      const text = dispatchedText();
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
        MAX_TEXT_BYTES,
      );
      expect(text).not.toContain("<&>");
    });
  });

  describe("when a trace carries high-cardinality events", () => {
    it("caps how many events are rendered per trace", async () => {
      sendMock.mockResolvedValue(undefined);
      await sendWithTraces([
        traceWith({
          traceId: "trace-1",
          events: Array.from({ length: 50 }, (_, e) => ({
            event_type: `evt-${e}`,
            metrics: {},
            event_details: {},
          })),
        }),
      ]);

      const text = dispatchedText();
      expect(text).toContain("*Event Type:* evt-0");
      expect(text).toContain("*Event Type:* evt-9");
      expect(text).not.toContain("evt-10");
      expect(text).not.toContain("evt-49");
    });

    it("caps how many metric and detail entries are rendered per event", async () => {
      sendMock.mockResolvedValue(undefined);
      await sendWithTraces([
        traceWith({
          traceId: "trace-1",
          events: [
            {
              event_type: "thumbs_up",
              metrics: Object.fromEntries(
                Array.from({ length: 50 }, (_, m) => [`m${m}`, m]),
              ),
              event_details: Object.fromEntries(
                Array.from({ length: 50 }, (_, d) => [`d${d}`, "v"]),
              ),
            },
          ],
        }),
      ]);

      const text = dispatchedText();
      expect(text).toContain("*m0:*");
      expect(text).toContain("*m19:*");
      expect(text).not.toContain("*m20:*");
      expect(text).toContain("*d0:*");
      expect(text).not.toContain("*d20:*");
    });

    it("truncates an oversized entry key instead of interpolating it whole", async () => {
      sendMock.mockResolvedValue(undefined);
      const hugeKey = "k".repeat(5000);
      await sendWithTraces([
        traceWith({
          traceId: "trace-1",
          events: [
            {
              event_type: "thumbs_up",
              metrics: {},
              event_details: { [hugeKey]: "v" },
            },
          ],
        }),
      ]);

      const text = dispatchedText();
      expect(text).not.toContain(hugeKey);
      expect(text).toContain("k".repeat(100) + "…");
    });
  });

  describe("when the trigger name and message are customer-authored", () => {
    it("escapes and bounds them like any other interpolated field", async () => {
      sendMock.mockResolvedValue(undefined);
      await sendSlackWebhook({
        triggerWebhook: "https://hooks.slack.com/services/T/B/X",
        triggerData: [],
        triggerName: "<script>alert(1)</script>",
        projectSlug: "demo",
        triggerType: AlertType.WARNING,
        triggerMessage: "a & b".repeat(500),
      });

      const text = dispatchedText();
      expect(text).not.toContain("<script>");
      expect(text).toContain("&lt;script&gt;");
      expect(text).toContain("…");
      expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
        MAX_TEXT_BYTES,
      );
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
