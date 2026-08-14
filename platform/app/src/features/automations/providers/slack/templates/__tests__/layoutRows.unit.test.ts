import { describe, expect, it } from "vitest";
import { buildLayoutRows } from "../layoutRows";
import type { SlackBlockKitTemplateId } from "../registry";

const build = (
  overrides: Partial<Parameters<typeof buildLayoutRows>[0]> = {},
) =>
  buildLayoutRows({
    cadence: "immediate",
    kind: "trace",
    deliveryMethod: "webhook",
    currentSource: "",
    defaultId: "trace_alert_compact",
    ...overrides,
  });

const idsOf = (rows: ReturnType<typeof build>): SlackBlockKitTemplateId[] =>
  rows.map((row) => row.option.id);

const rowFor = (rows: ReturnType<typeof build>, id: string) =>
  rows.find((row) => row.option.id === id);

describe("buildLayoutRows", () => {
  describe("given a trace automation", () => {
    it("offers only the layouts built for the draft's cadence", () => {
      const perTrace = build({ cadence: "immediate" });
      const digest = build({ cadence: "digest" });

      expect(rowFor(perTrace, "trace_alert_compact")).toBeDefined();
      expect(rowFor(perTrace, "digest_compact")).toBeUndefined();
      expect(rowFor(digest, "digest_compact")).toBeDefined();
      expect(rowFor(digest, "trace_alert_compact")).toBeUndefined();
    });

    it("badges the default layout", () => {
      const rows = build({ defaultId: "trace_alert_compact" });

      expect(rowFor(rows, "trace_alert_compact")?.isDefault).toBe(true);
      expect(rowFor(rows, "trace_alert_one_liner")?.isDefault).toBe(false);
    });

    /** @scenario "The richer templates are offered only for a bot connection" */
    it("locks a layout that leads with a gated block, on a webhook only", () => {
      const onWebhook = build({ deliveryMethod: "webhook" });
      const onBot = build({ deliveryMethod: "bot" });

      // "Eval failure banner" leads with a gated `alert` block; "Compact
      // notice" leads with an allowlisted one.
      expect(rowFor(onWebhook, "eval_failure_rich")?.isLocked).toBe(true);
      expect(rowFor(onWebhook, "trace_alert_compact")?.isLocked).toBe(false);
      expect(rowFor(onBot, "eval_failure_rich")?.isLocked).toBe(false);
    });

    it("selects the layout whose source the draft carries, and nothing for a custom one", () => {
      const oneLiner = rowFor(build(), "trace_alert_one_liner")!.option;
      const onPreset = build({ currentSource: oneLiner.source });
      const onCustom = build({ currentSource: "{{ hand written }}" });

      expect(rowFor(onPreset, "trace_alert_one_liner")?.isSelected).toBe(true);
      expect(rowFor(onPreset, "trace_alert_compact")?.isSelected).toBe(false);
      expect(onCustom.some((row) => row.isSelected)).toBe(false);
    });
  });

  describe("given a report", () => {
    it("offers each layout its source can fill exactly once", () => {
      const rows = build({ kind: "report", reportSource: "traceQuery" });

      expect(idsOf(rows)).toEqual([
        "report_table",
        "report_digest",
        "report_summary_card",
      ]);
    });
  });

  // Keyboard navigation walks the rows and finds the highlighted one by id,
  // so a repeated id would make Arrow keys jump back to the first copy.
  describe("given any draft the picker can render", () => {
    it("never repeats a layout", () => {
      const cases = [
        build(),
        build({ cadence: "digest" }),
        build({ kind: "graphAlert" }),
        build({ kind: "report", reportSource: "traceQuery" }),
        build({ kind: "report", reportSource: "customGraph" }),
      ];

      for (const rows of cases) {
        const ids = idsOf(rows);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });
});
