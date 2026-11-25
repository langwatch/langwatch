/**
 * Spec: modules/analytics/specs/custom-chart-saved-time-scale.feature
 */
import { customGraphInputSchema } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  type CustomGraphFormData,
  customGraphFormToCustomGraphInput,
} from "../custom-graph.screen.tsx";

/** The form value exactly as the native select hands it back: text. */
function formWithTimeScale(timeScale: string): CustomGraphFormData {
  return {
    title: "Completion time",
    graphType: { label: "Line Chart", value: "line", icon: null },
    series: [
      {
        name: "Average completion time",
        colorSet: "blueTones",
        metric: "performance.completion_time",
        aggregation: "avg",
        pipeline: { field: "", aggregation: "avg" },
      },
    ],
    includePrevious: false,
    timeScale,
  };
}

describe("customGraphFormToCustomGraphInput", () => {
  describe("when the author picked a bucket size", () => {
    /** @scenario "A chart saved with a bucket size stores it as a number of minutes" */
    it("saves the time scale as a number of minutes", () => {
      const saved = customGraphFormToCustomGraphInput(formWithTimeScale("60"));

      expect(saved?.timeScale).toBe(60);
      expect(customGraphInputSchema.validate(saved)).toBe(true);
    });
  });

  describe("when the author picked the full period", () => {
    /** @scenario "A chart saved over the full period stores the full period" */
    it("saves the time scale as full", () => {
      expect(customGraphFormToCustomGraphInput(formWithTimeScale("full"))?.timeScale).toBe("full");
    });
  });
});
