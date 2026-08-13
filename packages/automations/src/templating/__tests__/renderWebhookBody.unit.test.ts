import { describe, expect, it } from "vitest";
import { ALERT_TRIGGER_DEFAULTS, REPORT_TRIGGER_DEFAULTS } from "../defaults";
import { renderWebhookBody } from "../renderWebhookBody";
import {
  buildExampleReportTemplateContext,
  buildGraphAlertTemplateContext,
} from "../templateContext";
import { makeContext, makeMatch } from "./fixtures";

// Trace content that would break out of a naive JSON template — the `| json`
// discipline in the defaults must keep the envelope parseable.
const JSON_BREAKOUT = 'quote " brace } bracket ] newline\nend';

describe("renderWebhookBody", () => {
  describe("when no custom template is provided", () => {
    it("renders the default trace envelope as valid JSON", async () => {
      const rendered = await renderWebhookBody({
        template: null,
        context: makeContext(),
      });
      expect(rendered.usedDefault).toBe(true);
      expect(rendered.errors).toEqual([]);
      const parsed = JSON.parse(rendered.body) as {
        event: string;
        trigger: { id: string; name: string };
        matches: { traceId: string; input: string; output: string }[];
      };
      expect(parsed.event).toBe("trigger.matched");
      expect(parsed.trigger).toMatchObject({
        id: "trg_1",
        name: "High latency",
      });
      // #6716 P0: the envelope carries the trace's input AND output, not just
      // its id — a receiver (or an author reading a test-fire payload) needs
      // to see what happened, not just an identifier to look up.
      expect(parsed.matches[0]).toMatchObject({
        traceId: "trace_1",
        input: "what is the weather",
        output: "it is sunny",
      });
    });

    it("keeps the envelope parseable when trace content carries JSON control characters", async () => {
      const rendered = await renderWebhookBody({
        template: null,
        context: makeContext({
          matches: [
            makeMatch({
              trace: {
                id: "trace_1",
                input: JSON_BREAKOUT,
                output: JSON_BREAKOUT,
                url: "https://app.langwatch.ai/acme/traces/trace_1",
                metadata: {},
              },
            }),
          ],
        }),
      });
      const parsed = JSON.parse(rendered.body) as {
        matches: { input: string }[];
      };
      expect(parsed.matches[0]!.input).toBe(JSON_BREAKOUT);
    });

    it("renders the alert default envelope as valid JSON", async () => {
      const rendered = await renderWebhookBody({
        template: null,
        context: buildGraphAlertTemplateContext({
          trigger: { id: "trg_1", name: "High latency", alertType: "WARNING" },
          graph: { id: "graph_1", name: "Latency p95" },
          metric: { label: "Latency p95", seriesName: "0/duration/p95" },
          condition: { operator: "gt", threshold: 500, timePeriodMinutes: 60 },
          currentValue: 712,
          occurredAt: new Date("2026-06-21T10:00:00.000Z"),
          reason: "real-time",
          project: { id: "proj_1", name: "Acme", slug: "acme" },
          baseHost: "https://app.langwatch.ai",
        }),
        defaultBody: ALERT_TRIGGER_DEFAULTS.webhookBody,
      });
      const parsed = JSON.parse(rendered.body) as {
        event: string;
        metric: { label: string };
        currentValue: number;
      };
      expect(parsed.event).toBe("alert.fired");
      expect(parsed.metric.label).toBe("Latency p95");
      expect(parsed.currentValue).toBe(712);
    });

    it("renders the report default envelope as valid JSON", async () => {
      const rendered = await renderWebhookBody({
        template: null,
        context: buildExampleReportTemplateContext({
          baseHost: "https://app.langwatch.ai",
          project: { name: "Acme", slug: "acme" },
          trigger: { name: "Weekly report" },
          sourceKind: "traceQuery",
        }),
        defaultBody: REPORT_TRIGGER_DEFAULTS.webhookBody,
      });
      const parsed = JSON.parse(rendered.body) as { event: string };
      expect(parsed.event).toBe("report.scheduled");
    });
  });

  describe("when a custom template is provided", () => {
    it("renders it against the context", async () => {
      const rendered = await renderWebhookBody({
        template:
          '{ "name": {{ trigger.name | json }}, "n": {{ digest.count }} }',
        context: makeContext(),
      });
      expect(rendered.usedDefault).toBe(false);
      expect(JSON.parse(rendered.body)).toEqual({
        name: "High latency",
        n: 1,
      });
    });
  });

  describe("when the custom template renders invalid JSON", () => {
    /** @scenario "A JSON body that does not parse falls back to the framework default" */
    it("falls back to the default envelope and surfaces the error", async () => {
      const rendered = await renderWebhookBody({
        template: "not json at all {{ trigger.name }}",
        context: makeContext(),
      });
      expect(rendered.usedDefault).toBe(true);
      expect(rendered.errors.length).toBeGreaterThan(0);
      const parsed = JSON.parse(rendered.body) as { event: string };
      expect(parsed.event).toBe("trigger.matched");
    });
  });

  describe("when the custom template throws at render", () => {
    it("falls back to the default envelope and surfaces the error", async () => {
      const rendered = await renderWebhookBody({
        template: "{% unknown_tag %}",
        context: makeContext(),
      });
      expect(rendered.usedDefault).toBe(true);
      expect(rendered.errors.length).toBeGreaterThan(0);
      expect(() => JSON.parse(rendered.body)).not.toThrow();
    });
  });

  describe("given the body format is text", () => {
    it("sends the render output verbatim, without JSON normalising it", async () => {
      const rendered = await renderWebhookBody({
        template: "Trigger {{ trigger.name }} matched  {{ digest.count }}\n",
        context: makeContext(),
        format: "text",
      });

      expect(rendered.body).toBe("Trigger High latency matched  1\n");
      expect(rendered.usedDefault).toBe(false);
      expect(rendered.errors).toEqual([]);
    });

    it("keeps content that would break a JSON template intact", async () => {
      const rendered = await renderWebhookBody({
        template: "{{ matches[0].trace.input }}",
        context: makeContext({
          matches: [
            makeMatch({
              trace: {
                id: "trace_1",
                input: JSON_BREAKOUT,
                output: JSON_BREAKOUT,
                url: "https://app.langwatch.ai/acme/traces/trace_1",
                metadata: {},
              },
            }),
          ],
        }),
        format: "text",
      });

      expect(rendered.body).toBe(JSON_BREAKOUT);
    });

    it("reports the author's missing variables without failing the render", async () => {
      const rendered = await renderWebhookBody({
        template: "value: {{ trigger.nmae }}",
        context: makeContext(),
        format: "text",
      });

      expect(rendered.missingVariables.length).toBeGreaterThan(0);
      expect(rendered.errors).toEqual([]);
    });

    describe("when no template is written", () => {
      it("sends an empty body rather than a JSON envelope the endpoint cannot read", async () => {
        const rendered = await renderWebhookBody({
          template: null,
          context: makeContext(),
          format: "text",
        });

        expect(rendered.body).toBe("");
        expect(rendered.usedDefault).toBe(false);
        expect(rendered.errors).toEqual([]);
      });
    });

    describe("when the template throws at render", () => {
      /** @scenario "A plain-text body that fails to render sends nothing" */
      it("sends an empty body and surfaces the error", async () => {
        const rendered = await renderWebhookBody({
          template: "{% unknown_tag %}",
          context: makeContext(),
          format: "text",
        });

        expect(rendered.body).toBe("");
        expect(rendered.usedDefault).toBe(false);
        expect(rendered.errors.length).toBeGreaterThan(0);
      });
    });
  });
});
