/**
 * The explore chart's title and query line are pure functions of the three
 * controls. Pinned here so the sketch never drifts from what the controls
 * say, and so the copy stays in full words.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPLORE_SELECTION,
  EXPLORE_TEMPLATES,
  exploreChartTitle,
  exploreQueryLine,
} from "../exploreQuery";

describe("the explore query line", () => {
  describe("when the controls are changed", () => {
    /** @scenario "The query line follows the measure, breakdown and interval" */
    it("rewrites the aggregate, dimension and bin from the selection", () => {
      const selection = {
        measure: "requests",
        breakdown: "model",
        interval: "day",
      } as const;

      expect(exploreQueryLine(selection)).toBe(
        "usage | summarize count() by model, bin(1d)",
      );
      expect(exploreChartTitle(selection)).toBe("Requests by model · daily");
    });

    it("opens on spend by department, weekly, in full words", () => {
      expect(exploreQueryLine(DEFAULT_EXPLORE_SELECTION)).toBe(
        "usage | summarize sum(cost) by department, bin(1w)",
      );
      expect(exploreChartTitle(DEFAULT_EXPLORE_SELECTION)).toBe(
        "Cost by department · weekly",
      );
    });
  });

  describe("when a template is picked", () => {
    /** @scenario "A template rewrites the three controls at once" */
    it("carries a complete selection, so nothing is left over from before", () => {
      const byModel = EXPLORE_TEMPLATES.find(
        (template) => template.label === "Requests by model",
      );
      expect(byModel?.selection).toEqual({
        measure: "requests",
        breakdown: "model",
        interval: "day",
      });
      for (const template of EXPLORE_TEMPLATES) {
        expect(Object.keys(template.selection).sort()).toEqual([
          "breakdown",
          "interval",
          "measure",
        ]);
      }
    });
  });
});
