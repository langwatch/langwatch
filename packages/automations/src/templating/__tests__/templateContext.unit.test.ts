import { describe, expect, it } from "vitest";
import {
  buildGraphAlertTemplateContext,
  buildReportTemplateContext,
  buildTemplateContext,
} from "../templateContext";

const baseArgs = {
  trigger: {
    id: "trg_1",
    name: "High latency",
    alertType: null,
  },
  project: { name: "Acme", slug: "acme" },
  baseHost: "https://app.langwatch.ai",
};

describe("buildTemplateContext", () => {
  describe("when given trace matches", () => {
    /** @scenario "Notification links point at the Trace Explorer trace path" */
    it("builds trace URLs and the project URL from the base host", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "trace_1", input: "in", output: "out" }],
      });
      expect(ctx.project.url).toBe("https://app.langwatch.ai/acme");
      expect(ctx.matches[0]?.trace.url).toBe(
        "https://app.langwatch.ai/acme/traces/trace_1",
      );
      expect(ctx.matches[0]?.trace.id).toBe("trace_1");
    });
  });

  describe("when a match is a custom graph", () => {
    it("builds the analytics graph URL", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ graphId: "graph_1" }],
      });
      expect(ctx.matches[0]?.trace.url).toBe(
        "https://app.langwatch.ai/acme/analytics/custom/graph_1",
      );
    });
  });

  describe("when given several matches", () => {
    it("sets the digest count to the number of matches", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }, { traceId: "b" }, { traceId: "c" }],
      });
      expect(ctx.digest.count).toBe(3);
    });
  });

  describe("when given a digest window", () => {
    it("serializes the bounds to ISO strings", () => {
      const start = new Date("2026-05-29T00:00:00.000Z");
      const end = new Date("2026-05-29T01:00:00.000Z");
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }],
        window: { start, end },
      });
      expect(ctx.digest.windowStart).toBe("2026-05-29T00:00:00.000Z");
      expect(ctx.digest.windowEnd).toBe("2026-05-29T01:00:00.000Z");
    });

    it("leaves the window null for an immediate dispatch", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        matches: [{ traceId: "a" }],
      });
      expect(ctx.digest.windowStart).toBeNull();
      expect(ctx.digest.windowEnd).toBeNull();
    });
  });

  describe("given a trigger name carrying CR/LF header-injection payload", () => {
    const hostileName = "Alert\r\nBcc: attacker@evil.test";

    it("strips CR/LF from trigger.name so it can't inject an email header", () => {
      const ctx = buildTemplateContext({
        ...baseArgs,
        trigger: { ...baseArgs.trigger, name: hostileName },
        matches: [{ traceId: "a" }],
      });
      expect(ctx.trigger.name).toBe("Alert Bcc: attacker@evil.test");
      expect(ctx.trigger.name).not.toMatch(/[\r\n]/);
    });
  });
});

describe("buildGraphAlertTemplateContext", () => {
  describe("given a trigger name carrying CR/LF header-injection payload", () => {
    it("strips CR/LF from trigger.name so it can't inject an email header", () => {
      const ctx = buildGraphAlertTemplateContext({
        trigger: {
          id: "trg_1",
          name: "Spike\r\nBcc: attacker@evil.test",
          alertType: "WARNING",
        },
        graph: { id: "graph_1", name: "Trace count" },
        metric: { label: "Trace count", seriesName: "0/trace_id/cardinality" },
        condition: { operator: "gt", threshold: 10, timePeriodMinutes: 30 },
        currentValue: 12,
        occurredAt: new Date("2026-05-29T00:00:00.000Z"),
        reason: "real-time",
        project: { id: "proj_1", name: "Acme", slug: "acme" },
        baseHost: "https://app.langwatch.ai",
      });
      expect(ctx.trigger.name).toBe("Spike Bcc: attacker@evil.test");
      expect(ctx.trigger.name).not.toMatch(/[\r\n]/);
    });
  });
});

describe("buildReportTemplateContext", () => {
  describe("given a trigger name carrying CR/LF header-injection payload", () => {
    it("strips CR/LF from trigger.name so it can't inject an email header", () => {
      const ctx = buildReportTemplateContext({
        trigger: { id: "trg_1", name: "Weekly\r\nBcc: attacker@evil.test" },
        report: {
          sourceKind: "traceQuery",
          sourceLabel: "Top 5 matching traces",
          scheduleLabel: "every Monday at 09:00 (UTC)",
        },
        viewUrl: "https://app.langwatch.ai/acme/messages",
        occurredAt: new Date("2026-05-29T00:00:00.000Z"),
        project: { id: "proj_1", name: "Acme", slug: "acme" },
        baseHost: "https://app.langwatch.ai",
      });
      expect(ctx.trigger.name).toBe("Weekly Bcc: attacker@evil.test");
      expect(ctx.trigger.name).not.toMatch(/[\r\n]/);
    });
  });
});
