import { describe, expect, it } from "vitest";
import {
  pickDefaultSlackBlockKitTemplateId,
  SLACK_BLOCK_KIT_TEMPLATES,
  templateOptionsFor,
} from "../registry";

const GATED_BLOCKS = ["alert", "card", "data_visualization", "data_table"];

describe("slack Block Kit template registry", () => {
  describe("given the bundled template set", () => {
    it("stamps a kind on every template", () => {
      for (const template of SLACK_BLOCK_KIT_TEMPLATES) {
        expect(["trace", "graphAlert", "report"]).toContain(template.kind);
      }
    });

    it("keeps every graph-alert template on the immediate cadence", () => {
      const alertTemplates = SLACK_BLOCK_KIT_TEMPLATES.filter(
        (t) => t.kind === "graphAlert",
      );
      expect(alertTemplates.length).toBeGreaterThan(0);
      for (const template of alertTemplates) {
        expect(template.cadenceFit).toBe("immediate");
      }
    });

    it("names a valid modern block on every gated template", () => {
      const gated = SLACK_BLOCK_KIT_TEMPLATES.filter((t) => t.gatedBlock);
      expect(gated.length).toBeGreaterThan(0);
      for (const template of gated) {
        expect(GATED_BLOCKS).toContain(template.gatedBlock);
      }
    });
  });

  describe("when filtering options for a trace draft", () => {
    it("returns only trace templates matching the cadence", () => {
      const options = templateOptionsFor({
        cadence: "immediate",
        kind: "trace",
      });
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.kind).toBe("trace");
        expect(["immediate", "both"]).toContain(option.cadenceFit);
      }
    });

    it("returns every trace digest template for the digest cadence", () => {
      const options = templateOptionsFor({ cadence: "digest", kind: "trace" });
      expect(options.map((o) => o.id)).toEqual([
        "digest_compact",
        "digest_evaluator_rollup",
        "digest_inline_rich",
        "digest_table",
      ]);
    });
  });

  describe("when filtering options for a graph-alert draft", () => {
    it("returns every graph-alert template, including the modern-block ones", () => {
      const options = templateOptionsFor({
        cadence: "immediate",
        kind: "graphAlert",
      });
      expect(options.map((o) => o.id)).toEqual([
        "graph_alert_compact",
        "graph_alert_detailed",
        "graph_alert_one_liner",
        "graph_alert_resolved",
        "graph_alert_no_data",
        "graph_alert_history_table",
      ]);
    });

    it("returns no graph-alert templates for the digest cadence", () => {
      const options = templateOptionsFor({
        cadence: "digest",
        kind: "graphAlert",
      });
      expect(options).toEqual([]);
    });
  });

  describe("when filtering options for a report draft", () => {
    it("surfaces the report templates at either cadence", () => {
      const immediate = templateOptionsFor({
        cadence: "immediate",
        kind: "report",
      });
      const digest = templateOptionsFor({ cadence: "digest", kind: "report" });
      expect(immediate.map((o) => o.id)).toEqual([
        "report_digest",
        "report_summary_card",
        "report_table",
      ]);
      expect(digest.map((o) => o.id)).toEqual(immediate.map((o) => o.id));
    });
  });

  describe("given the modern-block templates (ADR-041 Phase 3)", () => {
    it("surfaces every gated template in a picker view (none are hidden)", () => {
      const gated = SLACK_BLOCK_KIT_TEMPLATES.filter((t) => t.gatedBlock);
      const surfaced = new Set(
        [
          ...templateOptionsFor({ cadence: "immediate", kind: "graphAlert" }),
          ...templateOptionsFor({ cadence: "digest", kind: "graphAlert" }),
          ...templateOptionsFor({ cadence: "immediate", kind: "trace" }),
          ...templateOptionsFor({ cadence: "digest", kind: "trace" }),
          ...templateOptionsFor({ cadence: "immediate", kind: "report" }),
        ].map((o) => o.id),
      );
      for (const template of gated) {
        expect(surfaced.has(template.id)).toBe(true);
      }
    });
  });

  describe("when picking the default template", () => {
    it("picks the compact alert for graph-alert drafts", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "immediate",
          hasEvaluationFilter: false,
          kind: "graphAlert",
        }),
      ).toBe("graph_alert_compact");
    });

    it("picks the compact alert for graph-alert drafts even with an evaluation filter", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "immediate",
          hasEvaluationFilter: true,
          kind: "graphAlert",
        }),
      ).toBe("graph_alert_compact");
    });

    it("picks the compact trace alert for plain trace drafts", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "immediate",
          hasEvaluationFilter: false,
          kind: "trace",
        }),
      ).toBe("trace_alert_compact");
    });

    it("picks the eval-failure template for trace drafts with an evaluation filter", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "immediate",
          hasEvaluationFilter: true,
          kind: "trace",
        }),
      ).toBe("eval_failure_detailed");
    });

    it("picks the rich digest for trace digest drafts", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "digest",
          hasEvaluationFilter: false,
          kind: "trace",
        }),
      ).toBe("digest_inline_rich");
    });

    it("picks the report digest for report drafts", () => {
      expect(
        pickDefaultSlackBlockKitTemplateId({
          cadence: "digest",
          hasEvaluationFilter: false,
          kind: "report",
        }),
      ).toBe("report_digest");
    });

    it("defaults to a template that delivers fully (never a gated one)", () => {
      const cases = [
        { cadence: "immediate", kind: "trace", hasEvaluationFilter: false },
        { cadence: "immediate", kind: "trace", hasEvaluationFilter: true },
        { cadence: "digest", kind: "trace", hasEvaluationFilter: false },
        { cadence: "immediate", kind: "graphAlert", hasEvaluationFilter: false },
        { cadence: "digest", kind: "report", hasEvaluationFilter: false },
      ] as const;
      for (const c of cases) {
        const id = pickDefaultSlackBlockKitTemplateId(c);
        const option = SLACK_BLOCK_KIT_TEMPLATES.find((t) => t.id === id);
        expect(option?.gatedBlock).toBeUndefined();
      }
    });
  });
});
