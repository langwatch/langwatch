import { describe, expect, it } from "vitest";
import {
  pickDefaultSlackBlockKitTemplateId,
  reportSourceIsAutoLayout,
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
    describe("when the report sends matching traces", () => {
      it("offers only layouts that render the traces", () => {
        const options = templateOptionsFor({
          cadence: "immediate",
          kind: "report",
          reportSource: "traceQuery",
        });
        expect(options.map((o) => o.id)).toEqual([
          "report_table",
          "report_digest",
          "report_summary_card",
        ]);
      });
    });

    describe("when the report sends a custom graph", () => {
      it("offers only chart layouts — a table of traces has no rows to show", () => {
        const options = templateOptionsFor({
          cadence: "immediate",
          kind: "report",
          reportSource: "customGraph",
        });
        expect(options.map((o) => o.id)).toEqual([
          "report_chart",
          "report_chart_card",
        ]);
      });
    });

    describe("when the report sends a dashboard", () => {
      it("offers no layouts at all — the panels map straight to the message", () => {
        expect(
          templateOptionsFor({
            cadence: "immediate",
            kind: "report",
            reportSource: "dashboard",
          }),
        ).toEqual([]);
        expect(reportSourceIsAutoLayout("dashboard")).toBe(true);
        expect(reportSourceIsAutoLayout("customGraph")).toBe(false);
        expect(reportSourceIsAutoLayout("traceQuery")).toBe(false);
      });
    });

    it("offers the same layouts at either cadence — a report runs on a schedule", () => {
      const immediate = templateOptionsFor({
        cadence: "immediate",
        kind: "report",
        reportSource: "traceQuery",
      });
      const digest = templateOptionsFor({
        cadence: "digest",
        kind: "report",
        reportSource: "traceQuery",
      });
      expect(digest.map((o) => o.id)).toEqual(immediate.map((o) => o.id));
    });
  });

  describe("given the modern-block templates (ADR-041 Phase 3)", () => {
    it("surfaces every gated template in a picker view (none are hidden)", () => {
      // An auto layout is applied for its source rather than chosen, so it is
      // deliberately absent from every gallery — it is the one exception.
      const gated = SLACK_BLOCK_KIT_TEMPLATES.filter(
        (t) => t.gatedBlock && t.autoFor === undefined,
      );
      const surfaced = new Set(
        [
          ...templateOptionsFor({ cadence: "immediate", kind: "graphAlert" }),
          ...templateOptionsFor({ cadence: "digest", kind: "graphAlert" }),
          ...templateOptionsFor({ cadence: "immediate", kind: "trace" }),
          ...templateOptionsFor({ cadence: "digest", kind: "trace" }),
          ...templateOptionsFor({
            cadence: "immediate",
            kind: "report",
            reportSource: "traceQuery",
          }),
          ...templateOptionsFor({
            cadence: "immediate",
            kind: "report",
            reportSource: "customGraph",
          }),
        ].map((o) => o.id),
      );
      for (const template of gated) {
        expect(surfaced.has(template.id)).toBe(true);
      }
    });

    it("keeps every auto layout out of the galleries", () => {
      const auto = SLACK_BLOCK_KIT_TEMPLATES.filter(
        (t) => t.autoFor !== undefined,
      );
      expect(auto.length).toBeGreaterThan(0);
      for (const template of auto) {
        expect(
          templateOptionsFor({
            cadence: "immediate",
            kind: "report",
            reportSource: template.autoFor,
          }),
        ).toEqual([]);
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

    describe("when the draft is a report", () => {
      it("picks the layout that fits what the report sends", () => {
        const pick = (reportSource: "traceQuery" | "customGraph" | "dashboard") =>
          pickDefaultSlackBlockKitTemplateId({
            cadence: "digest",
            hasEvaluationFilter: false,
            kind: "report",
            reportSource,
          });
        expect(pick("traceQuery")).toBe("report_table");
        expect(pick("customGraph")).toBe("report_chart");
        expect(pick("dashboard")).toBe("report_dashboard");
      });
    });

    it("defaults a trace or alert draft to a template that delivers fully (never a gated one)", () => {
      // Trace and alert drafts always have a non-gated layout that renders in
      // full on a webhook, so the default must be one of them.
      const cases = [
        { cadence: "immediate", kind: "trace", hasEvaluationFilter: false },
        { cadence: "immediate", kind: "trace", hasEvaluationFilter: true },
        { cadence: "digest", kind: "trace", hasEvaluationFilter: false },
        { cadence: "immediate", kind: "graphAlert", hasEvaluationFilter: false },
      ] as const;
      for (const c of cases) {
        const id = pickDefaultSlackBlockKitTemplateId(c);
        const option = SLACK_BLOCK_KIT_TEMPLATES.find((t) => t.id === id);
        expect(option?.gatedBlock).toBeUndefined();
      }
    });

    describe("when a report's content has no ungated way to render it", () => {
      it("still defaults to the layout that shows the data", () => {
        // A chart report's default HAS to be a chart — there is no non-gated
        // chart block. New Slack connections are bot-only (webhooks are
        // legacy), and on a webhook the block is stripped and the message
        // degrades to its headline fallback rather than failing, so leading
        // with the real layout is right. The parity suite pins that every one
        // of these survives the allowlist non-empty.
        const id = pickDefaultSlackBlockKitTemplateId({
          cadence: "digest",
          hasEvaluationFilter: false,
          kind: "report",
          reportSource: "customGraph",
        });
        const option = SLACK_BLOCK_KIT_TEMPLATES.find((t) => t.id === id);
        expect(option?.gatedBlock).toBe("data_visualization");
      });
    });
  });
});
