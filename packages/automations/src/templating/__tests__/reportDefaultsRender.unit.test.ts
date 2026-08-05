import { describe, expect, it } from "vitest";
import { MAX_SECTION_TEXT_CHARS } from "../blockKitAllowlist";
import {
  ALERT_TRIGGER_DEFAULTS,
  defaultsForSourceKind,
  REPORT_TRIGGER_DEFAULTS,
  TRACE_TRIGGER_DEFAULTS,
} from "../defaults";
import { renderTriggerSlack } from "../renderSlack";
import {
  buildReportTemplateContext,
  type ReportTemplateContext,
  type ReportTraceRow,
} from "../templateContext";

const SLACK_DEFAULTS = {
  slackString: REPORT_TRIGGER_DEFAULTS.slackString,
  slackBlockKit: REPORT_TRIGGER_DEFAULTS.slackBlockKit,
};

/** A trace row with a realistic (long) input preview — the report snippet cap
 *  is 120 chars, so a row costs roughly 240 characters in the message. */
function makeTraceRow(index: number): ReportTraceRow {
  return {
    traceId: `trace_${String(index).padStart(6, "0")}`,
    url: `https://app.langwatch.ai/acme/messages/trace_${index}`,
    timestamp: "2026-06-21T10:00:00.000Z",
    input: "Summarize the Q3 earnings call for the leadership team".repeat(2),
    output: "Revenue grew 12% year over year.",
    model: "gpt-5-mini",
    status: "ok",
    costUsd: 0.0241,
    durationMs: 1834,
  };
}

function makeReportContext(traceCount: number): ReportTemplateContext {
  return buildReportTemplateContext({
    trigger: { id: "trg_1", name: "Weekly traces" },
    report: {
      sourceLabel: `Top ${traceCount} matching traces`,
      scheduleLabel: "every Monday at 09:00 (UTC)",
      sourceKind: "traceQuery",
    },
    viewUrl: "https://app.langwatch.ai/acme/messages",
    traces: Array.from({ length: traceCount }, (_, i) => makeTraceRow(i)),
    occurredAt: new Date("2026-06-21T10:00:00.000Z"),
    project: { id: "proj_1", name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
  });
}

function sectionTexts(blocks: Record<string, unknown>[]): string[] {
  return blocks
    .filter((block) => block.type === "section")
    .map((block) => (block.text as { text?: string } | undefined)?.text ?? "");
}

describe("report-default Slack rendering", () => {
  describe("given a report whose row count exceeds what one Slack section holds", () => {
    describe("when rendering the default Block Kit template", () => {
      it("keeps every section within Slack's character limit", async () => {
        const slack = await renderTriggerSlack({
          templateType: "block_kit",
          template: null,
          context: makeReportContext(100),
          defaults: SLACK_DEFAULTS,
        });
        const payload = slack.payload as {
          blocks: Record<string, unknown>[];
        };

        expect(payload.blocks.length).toBeGreaterThan(0);
        for (const text of sectionTexts(payload.blocks)) {
          expect(text.length).toBeLessThanOrEqual(MAX_SECTION_TEXT_CHARS);
        }
      });

      it("tells the reader how many rows are not listed", async () => {
        const slack = await renderTriggerSlack({
          templateType: "block_kit",
          template: null,
          context: makeReportContext(100),
          defaults: SLACK_DEFAULTS,
        });
        const payload = slack.payload as {
          blocks: Record<string, unknown>[];
        };

        expect(sectionTexts(payload.blocks).join("\n")).toContain(
          "…and 90 more",
        );
      });
    });

    describe("when rendering the default plain-text template", () => {
      it("lists the first rows and names the remainder", async () => {
        const slack = await renderTriggerSlack({
          templateType: "string",
          template: null,
          context: makeReportContext(42),
          defaults: SLACK_DEFAULTS,
        });
        const payload = slack.payload as { text: string };

        expect(payload.text).toContain("trace_000000");
        expect(payload.text).toContain("…and 32 more");
        expect(payload.text).not.toContain("trace_000041");
      });
    });
  });

  describe("given a report that fits in one message", () => {
    it("lists every row without an and-more line", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: null,
        context: makeReportContext(3),
        defaults: SLACK_DEFAULTS,
      });
      const payload = slack.payload as { blocks: Record<string, unknown>[] };
      const rendered = sectionTexts(payload.blocks).join("\n");

      expect(rendered).toContain("trace_000002");
      expect(rendered).not.toContain("more_");
    });
  });
});

describe("defaultsForSourceKind", () => {
  describe("when the trigger is a report", () => {
    it("resolves the report template set", () => {
      expect(defaultsForSourceKind("report")).toBe(REPORT_TRIGGER_DEFAULTS);
    });
  });

  describe("when the trigger is a graph alert", () => {
    it("resolves the alert template set", () => {
      expect(defaultsForSourceKind("graphAlert")).toBe(ALERT_TRIGGER_DEFAULTS);
    });
  });

  describe("when the trigger is a trace automation", () => {
    it("resolves the trace template set", () => {
      expect(defaultsForSourceKind("trace")).toBe(TRACE_TRIGGER_DEFAULTS);
    });
  });
});
