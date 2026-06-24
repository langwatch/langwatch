import { describe, expect, it } from "vitest";
import { truncatedReadTooltip } from "../datasetEditorCopy";

describe("truncatedReadTooltip", () => {
  describe("when a large dataset's editor read is truncated", () => {
    it("states what is shown vs the total and how to get the full data", () => {
      const copy = truncatedReadTooltip({ shown: 3, total: 1640 });

      // Pin the customer-facing message so it can't silently drift.
      expect(copy).toBe(
        "This dataset is too large to display in full here — showing 3 out of 1,640 rows. Editing a visible row saves just that row; use Download as CSV for the complete dataset.",
      );
    });

    it("formats both counts with thousands separators", () => {
      const copy = truncatedReadTooltip({ shown: 10, total: 1000000 });
      expect(copy).toContain("showing 10 out of 1,000,000 rows");
    });
  });
});
