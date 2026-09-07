/**
 * How wide the columns of a comparison table are.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { describe, expect, it } from "vitest";
import {
  comparisonColumns,
  TARGET_COLUMN_MAX_WIDTH,
  TARGET_COLUMN_MIN_WIDTH,
  targetColumnWidth,
} from "../comparison-columns";

describe("targetColumnWidth", () => {
  describe("given short target names", () => {
    it("keeps the columns at their smallest width", () => {
      expect(targetColumnWidth([{ label: "dev" }, { label: "prod" }])).toBe(
        TARGET_COLUMN_MIN_WIDTH,
      );
    });
  });

  describe("given a target name with its environment and parameters", () => {
    /** @scenario "A long target name keeps its own column" */
    it("widens every column to the longest label", () => {
      const short = { label: "prod-agent" };
      const long = {
        label: "support-agent · development (Ana), model=gpt-5-mini",
      };

      const width = targetColumnWidth([short, long]);

      expect(width).toBeGreaterThan(TARGET_COLUMN_MIN_WIDTH);
      expect(width).toBeLessThanOrEqual(TARGET_COLUMN_MAX_WIDTH);
    });

    /** @scenario "A long target name keeps its own column" */
    it("stops widening at the maximum, where the label wraps instead", () => {
      const width = targetColumnWidth([{ label: "a".repeat(400) }]);

      expect(width).toBe(TARGET_COLUMN_MAX_WIDTH);
    });
  });
});

describe("comparisonColumns", () => {
  describe("given two targets", () => {
    /** @scenario "A long target name keeps its own column" */
    it("gives the header and the rows one template and one smallest width", () => {
      const targets = [
        { label: "support-agent · production" },
        { label: "support-agent · development (Ana)" },
      ];

      const { template, minWidth } = comparisonColumns(targets);
      const width = targetColumnWidth(targets);

      expect(template).toBe(
        `minmax(200px, 1.2fr) repeat(2, minmax(${width}px, 1fr))`,
      );
      expect(minWidth).toBe(`${200 + 2 * width}px`);
    });
  });
});
