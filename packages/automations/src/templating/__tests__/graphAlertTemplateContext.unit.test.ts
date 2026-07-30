import { describe, expect, it } from "vitest";
import { buildGraphAlertTemplateContext } from "../templateContext";

const NOW = new Date("2026-06-21T10:00:00.000Z");

const baseArgs = {
  trigger: {
    id: "trg_alert_1",
    name: "High error rate",
    alertType: "WARNING" as const,
  },
  graph: { id: "graph_42", name: "Errors per minute" },
  metric: { label: "Error count", seriesName: "0/error_count/sum" },
  condition: { operator: "gt", threshold: 100, timePeriodMinutes: 60 },
  currentValue: 250,
  occurredAt: NOW,
  reason: "real-time" as const,
  project: { id: "proj_1", name: "Acme", slug: "acme" },
  baseHost: "https://app.langwatch.ai",
};

describe("buildGraphAlertTemplateContext", () => {
  describe("given a metric label carrying CR/LF (SMTP header-injection attempt)", () => {
    it("collapses CR/LF/NUL to spaces in metric.label while leaving seriesName untouched", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        metric: {
          label: "Latency\r\nBcc: evil@x.com\0end",
          seriesName: "0/error_count/sum",
        },
      });
      expect(ctx.metric.label).not.toMatch(/[\r\n\0]/);
      expect(ctx.metric.label).toBe("Latency Bcc: evil@x.com end");
      expect(ctx.metric.seriesName).toBe("0/error_count/sum");
    });
  });

  describe("given metric history and a previous value", () => {
    it("carries history through as ISO-stamped points with a matching sparkline", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        history: [
          { timestamp: new Date("2026-06-21T09:00:00.000Z"), value: 1 },
          { timestamp: "2026-06-21T09:30:00Z", value: 5 },
          { timestamp: new Date("2026-06-21T10:00:00.000Z"), value: 9 },
        ],
        previousValue: 4,
      });
      expect(ctx.history).toEqual([
        { timestamp: "2026-06-21T09:00:00.000Z", value: 1 },
        { timestamp: "2026-06-21T09:30:00Z", value: 5 },
        { timestamp: "2026-06-21T10:00:00.000Z", value: 9 },
      ]);
      expect(ctx.sparkline).toBe("▁▅█");
      expect(ctx.previousValue).toBe(4);
    });

    it("renders a flat series as mid glyphs and an empty history as an empty sparkline", () => {
      const flat = buildGraphAlertTemplateContext({
        ...baseArgs,
        history: [
          { timestamp: "t1", value: 5 },
          { timestamp: "t2", value: 5 },
        ],
      });
      expect(flat.sparkline).toBe("▄▄");
      const empty = buildGraphAlertTemplateContext(baseArgs);
      expect(empty.history).toEqual([]);
      expect(empty.sparkline).toBe("");
      expect(empty.previousValue).toBeNull();
    });
  });

  describe("given an incident window", () => {
    it("appends startDate/endDate to the graph URL", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        window: {
          start: new Date("2026-06-21T09:00:00.000Z"),
          end: NOW,
        },
      });
      expect(ctx.graph.url).toBe(
        "https://app.langwatch.ai/acme/analytics/custom/graph_42" +
          "?startDate=2026-06-21T09%3A00%3A00.000Z&endDate=2026-06-21T10%3A00%3A00.000Z",
      );
    });
  });

  describe("given a breach context", () => {
    it("carries every trigger field through unchanged", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.trigger.id).toBe("trg_alert_1");
      expect(ctx.trigger.name).toBe("High error rate");
      expect(ctx.trigger.alertType).toBe("WARNING");
    });

    it("derives the edit-automation URL from baseHost + project slug + trigger id", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.trigger.editUrl).toBe(
        "https://app.langwatch.ai/acme/automations?drawer.open=automation&drawer.automationId=trg_alert_1&drawer.source=email-link",
      );
    });

    it("builds the project URL from baseHost + slug", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.project.url).toBe("https://app.langwatch.ai/acme");
      expect(ctx.project.id).toBe("proj_1");
      expect(ctx.project.name).toBe("Acme");
      expect(ctx.project.slug).toBe("acme");
    });

    it("builds the custom-graph URL", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.graph.id).toBe("graph_42");
      expect(ctx.graph.name).toBe("Errors per minute");
      expect(ctx.graph.url).toBe(
        "https://app.langwatch.ai/acme/analytics/custom/graph_42",
      );
    });

    it("serializes the occurredAt timestamp to ISO-8601", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.occurredAt).toBe("2026-06-21T10:00:00.000Z");
    });

    it("propagates the current value verbatim", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.currentValue).toBe(250);
    });

    it("propagates the reason enum verbatim", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.reason).toBe("real-time");
    });

    it("carries the metric label and seriesName", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.metric.label).toBe("Error count");
      expect(ctx.metric.seriesName).toBe("0/error_count/sum");
    });

    it("propagates the condition operator + threshold + timePeriod", () => {
      const ctx = buildGraphAlertTemplateContext(baseArgs);
      expect(ctx.condition.operator).toBe("gt");
      expect(ctx.condition.threshold).toBe(100);
      expect(ctx.condition.timePeriodMinutes).toBe(60);
    });
  });

  describe("operatorLabel derivation", () => {
    const cases: Array<{ operator: string; label: string }> = [
      { operator: "gt", label: "is greater than" },
      { operator: "gte", label: "is greater than or equal to" },
      { operator: "lt", label: "is less than" },
      { operator: "lte", label: "is less than or equal to" },
      { operator: "eq", label: "is equal to" },
    ];

    for (const { operator, label } of cases) {
      describe(`when operator is "${operator}"`, () => {
        it(`labels it "${label}"`, () => {
          const ctx = buildGraphAlertTemplateContext({
            ...baseArgs,
            condition: { ...baseArgs.condition, operator },
          });
          expect(ctx.condition.operatorLabel).toBe(label);
        });
      });
    }

    describe("when operator is unrecognised", () => {
      it("falls back to the raw operator string", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, operator: "ne" },
        });
        expect(ctx.condition.operatorLabel).toBe("ne");
      });
    });
  });

  describe("timePeriodLabel derivation", () => {
    describe("when timePeriod is under one hour", () => {
      it("labels it last N minutes", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, timePeriodMinutes: 15 },
        });
        expect(ctx.condition.timePeriodLabel).toBe("last 15 minutes");
      });

      it("uses singular for one minute", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, timePeriodMinutes: 1 },
        });
        expect(ctx.condition.timePeriodLabel).toBe("last 1 minute");
      });
    });

    describe("when timePeriod is exactly an hour multiple", () => {
      it("labels singular for one hour", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, timePeriodMinutes: 60 },
        });
        expect(ctx.condition.timePeriodLabel).toBe("last 1 hour");
      });

      it("labels plural for two+ hours", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, timePeriodMinutes: 180 },
        });
        expect(ctx.condition.timePeriodLabel).toBe("last 3 hours");
      });
    });

    describe("when timePeriod is hours with leftover minutes", () => {
      it("falls back to the minute form", () => {
        const ctx = buildGraphAlertTemplateContext({
          ...baseArgs,
          condition: { ...baseArgs.condition, timePeriodMinutes: 90 },
        });
        expect(ctx.condition.timePeriodLabel).toBe("last 90 minutes");
      });
    });
  });

  describe("given a null alertType", () => {
    it("propagates null", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        trigger: { ...baseArgs.trigger, alertType: null },
      });
      expect(ctx.trigger.alertType).toBeNull();
    });
  });

  describe("given a heartbeat-absence reason", () => {
    it("propagates it through", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        reason: "heartbeat-absence",
      });
      expect(ctx.reason).toBe("heartbeat-absence");
    });
  });

  describe("given a heartbeat-resolve reason", () => {
    it("propagates it through", () => {
      const ctx = buildGraphAlertTemplateContext({
        ...baseArgs,
        reason: "heartbeat-resolve",
      });
      expect(ctx.reason).toBe("heartbeat-resolve");
    });
  });
});
