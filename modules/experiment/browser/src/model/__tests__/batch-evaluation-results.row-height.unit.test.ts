import { describe, expect, it } from "vitest";

import { collapsedPreviewOf } from "../batch-evaluation-results.row-height.ts";

describe("collapsedPreviewOf", () => {
  describe("given a value of many short lines", () => {
    /** @scenario "A collapsed preview stops at the line or character budget of its row height" */
    it("stops at the row height's line budget", () => {
      const text = Array.from({ length: 100 }, (_, line) => `line ${line}`).join("\n");

      const { preview, isCut } = collapsedPreviewOf({ text, rowHeight: "m" });

      expect(preview.split("\n")).toHaveLength(12);
      expect(isCut).toBe(true);
    });
  });

  describe("given one long line", () => {
    /** @scenario "A collapsed preview stops at the line or character budget of its row height" */
    it("stops at the row height's character budget", () => {
      const { preview, isCut } = collapsedPreviewOf({ text: "a".repeat(50_000), rowHeight: "l" });

      expect(preview).toHaveLength(2_500);
      expect(isCut).toBe(true);
    });
  });

  describe("given a value that fits", () => {
    it("keeps all of it", () => {
      expect(collapsedPreviewOf({ text: "short\nanswer", rowHeight: "s" })).toEqual({
        preview: "short\nanswer",
        isCut: false,
      });
    });
  });
});
