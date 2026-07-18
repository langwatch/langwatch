import { describe, expect, it } from "vitest";
import { renderTriggerSlack } from "~/shared/templating/renderSlack";
import {
  buildGraphAlertTemplateContext,
  type GraphAlertTemplateContext,
} from "~/shared/templating/templateContext";
import { SLACK_BLOCK_KIT_TEMPLATES } from "../registry";

/**
 * `history` is `[...previousPoints, ...currentPoints]` — oldest first, easily
 * 100+ buckets. Liquid applies `limit:` BEFORE `reversed`, so the obvious
 * `{% for point in history reversed limit: 20 %}` yields the OLDEST 20 points,
 * reversed: the breach that fired the alert never reaches its own message.
 * These tests pin the window on the newest end of history.
 */
const HISTORY_POINTS = 100;
const BREACH_VALUE = HISTORY_POINTS - 1;
const OCCURRED_AT = new Date("2026-06-21T18:00:00.000Z");

function makeContext(): GraphAlertTemplateContext {
  const history = Array.from({ length: HISTORY_POINTS }, (_, i) => ({
    timestamp: new Date(
      OCCURRED_AT.getTime() - (HISTORY_POINTS - 1 - i) * 5 * 60 * 1000,
    ),
    value: i,
  }));
  return buildGraphAlertTemplateContext({
    trigger: { id: "trg_1", name: "High latency", alertType: "CRITICAL" },
    graph: { id: "graph_1", name: "Latency p95" },
    metric: { label: "Latency p95", seriesName: "0/duration/p95" },
    condition: { operator: "gt", threshold: 50, timePeriodMinutes: 60 },
    currentValue: BREACH_VALUE,
    previousValue: BREACH_VALUE - 1,
    occurredAt: OCCURRED_AT,
    reason: "real-time",
    history,
    project: { id: "proj_1", name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
  });
}

function sourceOf(id: string): string {
  const option = SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.id === id);
  if (!option) throw new Error(`unknown template: ${id}`);
  return option.source;
}

async function renderBlocks(id: string): Promise<Record<string, unknown>[]> {
  const slack = await renderTriggerSlack({
    templateType: "block_kit",
    template: sourceOf(id),
    context: makeContext(),
    // A bot connection renders the chart / table blocks — the surface these
    // layouts are built for.
    allowGatedBlocks: true,
  });
  const payload = slack.payload as { blocks?: Record<string, unknown>[] };
  if (!payload.blocks) throw new Error("expected a blocks payload");
  return payload.blocks;
}

function blockOfType(
  blocks: Record<string, unknown>[],
  type: string,
): Record<string, unknown> {
  const block = blocks.find((b) => b.type === type);
  if (!block) throw new Error(`no ${type} block in the rendered message`);
  return block;
}

describe("graph alert history window", () => {
  describe("given a metric whose history is far longer than one message shows", () => {
    describe("when the detailed alert plots the metric", () => {
      it("charts the values that fired the alert, not the start of history", async () => {
        const blocks = await renderBlocks("graph_alert_detailed");
        const chart = blockOfType(blocks, "data_visualization").chart as {
          series: { data: { label: string; value: number }[] }[];
        };
        const data = chart.series[0]!.data;

        expect(data).toHaveLength(20);
        expect(data.at(-1)!.value).toBe(BREACH_VALUE);
        expect(data[0]!.value).toBe(BREACH_VALUE - 19);
      });

      it("keeps the plotted series in chronological order", async () => {
        const blocks = await renderBlocks("graph_alert_detailed");
        const chart = blockOfType(blocks, "data_visualization").chart as {
          series: { data: { label: string; value: number }[] }[];
          axis_config: { categories: string[] };
        };
        const data = chart.series[0]!.data;

        const values = data.map((point) => point.value);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        // The x-axis labels the same buckets the series plots, in the same order.
        expect(chart.axis_config.categories).toEqual(
          data.map((point) => point.label),
        );
      });

      it("names the newest buckets in the recent-values footnote", async () => {
        const blocks = await renderBlocks("graph_alert_detailed");
        const context = blockOfType(blocks, "context");
        const text = (context.elements as { type: string; text: string }[])[0]!
          .text;

        expect(text).toContain(`${BREACH_VALUE}`);
        expect(text).not.toContain("` 0");
      });
    });

    describe("when the history table lists the metric", () => {
      it("leads with the newest value under its Recent values caption", async () => {
        const blocks = await renderBlocks("graph_alert_history_table");
        const table = blockOfType(blocks, "data_table");
        const rows = table.rows as { type: string; value?: number }[][];

        // Row 0 is the header; the newest bucket is the first data row.
        expect(rows).toHaveLength(21);
        expect(rows[1]![1]!.value).toBe(BREACH_VALUE);
        expect(rows.at(-1)![1]!.value).toBe(BREACH_VALUE - 19);
      });
    });
  });
});
