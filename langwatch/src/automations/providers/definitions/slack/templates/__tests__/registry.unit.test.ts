import { describe, expect, it } from "vitest";
import {
  pickDefaultSlackBlockKitTemplateId,
  SLACK_BLOCK_KIT_TEMPLATES,
  templateOptionsFor,
} from "../registry";

describe("slack Block Kit template registry", () => {
  describe("given the bundled template set", () => {
    it("stamps a kind on every template", () => {
      for (const template of SLACK_BLOCK_KIT_TEMPLATES) {
        expect(["trace", "graphAlert"]).toContain(template.kind);
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

    it("returns only trace digest templates for the digest cadence", () => {
      const options = templateOptionsFor({ cadence: "digest", kind: "trace" });
      expect(options.map((o) => o.id)).toEqual([
        "digest_compact",
        "digest_evaluator_rollup",
        "digest_inline_rich",
      ]);
    });
  });

  describe("when filtering options for a graph-alert draft", () => {
    it("returns only graph-alert templates", () => {
      const options = templateOptionsFor({
        cadence: "immediate",
        kind: "graphAlert",
      });
      expect(options.map((o) => o.id)).toEqual([
        "graph_alert_compact",
        "graph_alert_detailed",
        "graph_alert_one_liner",
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
  });
});
