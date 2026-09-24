/**
 * The incoming-webhook leg: the mrkdwn text a trigger posts, and the trace
 * link it carries. @see specs/traces-v2/trace-drawer-shell.feature
 */
import type { SlackPayload } from "@langwatch/automation-contract";
import type { TraceRecord } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { SlackWebhookDeliveryAdapter } from "../slack.webhook-delivery.channel.ts";

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
  const adapter = SlackWebhookDeliveryAdapter.create(() => ({
    send: async (payload: SlackPayload) => void sent.push(payload),
  }));
  return { adapter, sent };
}

describe("SlackWebhookDeliveryAdapter.deliver", () => {
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
});
