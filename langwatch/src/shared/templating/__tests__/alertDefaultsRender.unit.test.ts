import { describe, expect, it } from "vitest";
import { ALERT_TRIGGER_DEFAULTS } from "../defaults";
import { renderTriggerEmail } from "../renderEmail";
import { renderTriggerSlack } from "../renderSlack";
import {
  buildGraphAlertTemplateContext,
  type GraphAlertTemplateContext,
} from "../templateContext";

function makeContext(
  overrides: Partial<Parameters<typeof buildGraphAlertTemplateContext>[0]> = {},
): GraphAlertTemplateContext {
  return buildGraphAlertTemplateContext({
    trigger: { id: "trg_1", name: "High latency", alertType: "WARNING" },
    graph: { id: "graph_1", name: "Latency p95" },
    metric: { label: "Latency p95", seriesName: "0/duration/p95" },
    condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
    currentValue: 712,
    occurredAt: new Date("2026-06-21T10:00:00.000Z"),
    reason: "real-time",
    project: { id: "proj_1", name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
    ...overrides,
  });
}

describe("alert-default email rendering", () => {
  describe("when rendering the default subject", () => {
    it("formats it with the trigger name, metric label, operator label and threshold", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
        defaults: {
          emailSubject: ALERT_TRIGGER_DEFAULTS.emailSubject,
          emailBody: ALERT_TRIGGER_DEFAULTS.emailBody,
        },
      });
      expect(email.subject).toBe(
        "[Alert] High latency — Latency p95 is greater than 500",
      );
    });
  });

  describe("when rendering the default body", () => {
    it("interpolates currentValue, threshold, timePeriodLabel and the graph link", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
        defaults: {
          emailSubject: ALERT_TRIGGER_DEFAULTS.emailSubject,
          emailBody: ALERT_TRIGGER_DEFAULTS.emailBody,
        },
      });
      expect(email.html).toContain("Latency p95");
      expect(email.html).toContain("is greater than");
      expect(email.html).toContain("500");
      expect(email.html).toContain("last 1 hour");
      expect(email.html).toContain("712");
      expect(email.html).toContain(
        'href="https://app.langwatch.ai/acme/analytics/custom/graph_1"',
      );
    });

    it("renders the chrome footer with the project + edit-automation links", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
        defaults: {
          emailSubject: ALERT_TRIGGER_DEFAULTS.emailSubject,
          emailBody: ALERT_TRIGGER_DEFAULTS.emailBody,
        },
      });
      expect(email.html).toContain("Edit automation");
      expect(email.html).toContain('href="https://app.langwatch.ai/acme"');
    });
  });
});

describe("alert-default Slack rendering", () => {
  describe("when rendering the default Slack string", () => {
    it("interpolates trigger name, metric label, operator, threshold, currentValue, and graph link", async () => {
      const slack = await renderTriggerSlack({
        templateType: "string",
        template: null,
        context: makeContext(),
        defaults: {
          slackString: ALERT_TRIGGER_DEFAULTS.slackString,
          slackBlockKit: ALERT_TRIGGER_DEFAULTS.slackBlockKit,
        },
      });
      const payload = slack.payload as { text: string };
      expect(payload.text).toContain("High latency");
      expect(payload.text).toContain("WARNING");
      expect(payload.text).toContain("Latency p95");
      expect(payload.text).toContain("is greater than");
      expect(payload.text).toContain("500");
      expect(payload.text).toContain("712");
      expect(payload.text).toContain(
        "https://app.langwatch.ai/acme/analytics/custom/graph_1",
      );
    });
  });

  describe("when rendering the default Block Kit template", () => {
    it("emits a header + metric + value + open-dashboard + edit-automation blocks", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: null,
        context: makeContext(),
        defaults: {
          slackString: ALERT_TRIGGER_DEFAULTS.slackString,
          slackBlockKit: ALERT_TRIGGER_DEFAULTS.slackBlockKit,
        },
      });
      const payload = slack.payload as { blocks: Array<Record<string, unknown>> };
      expect(payload.blocks.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(payload.blocks);
      expect(serialized).toContain("High latency");
      expect(serialized).toContain("Latency p95");
      expect(serialized).toContain("500");
      expect(serialized).toContain("712");
      expect(serialized).toContain(
        "https://app.langwatch.ai/acme/analytics/custom/graph_1",
      );
      expect(serialized).toContain("Edit automation");
    });
  });
});
