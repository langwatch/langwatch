/**
 * The incoming-webhook leg: the mrkdwn text a trigger posts, and the trace
 * link it carries. @see specs/traces-v2/trace-drawer-shell.feature
 */
import type { SlackPayload } from "@langwatch/automation-contract";
import type { TraceRecord } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  findSlackWebhookErrorExplanation,
  SlackWebhookDeliveryChannel,
} from "../slack.webhook-delivery.channel.ts";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/XXXX";
const STARTED_AT = 1714476000000;

function traceRecord(): TraceRecord {
  return {
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: STARTED_AT, inserted_at: STARTED_AT, updated_at: STARTED_AT },
    events: [],
    spans: [],
  };
}

function capturingAdapter() {
  const sent: SlackPayload[] = [];
  const adapter = SlackWebhookDeliveryChannel.create(() => ({
    send: async (payload: SlackPayload) => void sent.push(payload),
  }));
  return { adapter, sent };
}

describe("SlackWebhookDeliveryChannel.deliver", () => {
  describe("when the trigger matches a trace with a known start time", () => {
    /** @scenario "Notification links carry the timestamp" */
    it("links the trace with its start time, so the drawer opens in one pruned read", async () => {
      const { adapter, sent } = capturingAdapter();

      await adapter.deliver({
        triggerWebhook: WEBHOOK,
        triggerData: [
          {
            traceId: "trace-1",
            input: "user question",
            output: "assistant answer",
            fullTrace: traceRecord(),
          },
        ],
        triggerName: "Quality Alert",
        projectSlug: "demo",
        triggerType: "WARNING",
        triggerMessage: "",
        baseHost: "https://app.langwatch.test",
      });

      expect(sent).toHaveLength(1);
      const payload = sent[0];
      const text = payload && "text" in payload ? payload.text : "";
      expect(text).toContain(`/demo/traces/trace-1?t=${STARTED_AT}|trace-1>`);
      expect(text).toContain("*Input:* user question");
      expect(text).toContain("*Output:* assistant answer");
    });
  });

  describe("when the webhook post succeeds", () => {
    /** @scenario "An automation delivers through an incoming webhook" */
    it("posts once to the configured webhook", async () => {
      const { adapter, sent } = capturingAdapter();

      await adapter.deliverRendered({
        triggerWebhook: WEBHOOK,
        triggerName: "Quality Alert",
        payload: { text: "hello" },
      });

      expect(sent).toHaveLength(1);
    });
  });

  describe("when Slack refuses the webhook", () => {
    it("tells the author the webhook was revoked", async () => {
      const refused = {
        code: "slack_webhook_http_error",
        original: { response: { status: 403, data: "invalid_token" } },
      };
      const adapter = SlackWebhookDeliveryChannel.create(() => ({
        send: () => Promise.reject(refused),
      }));

      await expect(
        adapter.deliverRendered({
          triggerWebhook: WEBHOOK,
          triggerName: "Quality Alert",
          payload: { text: "hi" },
        }),
      ).rejects.toMatchObject({ customerMessage: findSlackWebhookErrorExplanation(refused)[0] });
      expect(findSlackWebhookErrorExplanation(refused)[0]).toContain("revoked");
    });
  });

  describe("when the URL is not a Slack incoming webhook", () => {
    it("refuses before posting, in words the author can act on", async () => {
      const { adapter, sent } = capturingAdapter();

      await expect(
        adapter.deliverRendered({
          triggerWebhook: "https://example.com/hook",
          triggerName: "x",
          payload: { text: "hi" },
        }),
      ).rejects.toMatchObject({ customerMessage: expect.stringContaining("hooks.slack.com") });
      expect(sent).toHaveLength(0);
    });
  });
});
