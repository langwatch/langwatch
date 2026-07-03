import { describe, expect, it } from "vitest";
import { toCategoryBarRows } from "../CategoryBreakdownBars";

/**
 * Pins the divide-by-zero guard in `toCategoryBarRows` — the share math is
 * `total > 0 ? cost/total*100 : 0`. An all-zero-cost set (real: a window with
 * only free/bundled traffic) must yield 0% shares, never NaN.
 */
describe("toCategoryBarRows", () => {
  describe("given rows whose costs sum to a positive total", () => {
    it("assigns each lane its share of the total cost", () => {
      const rows = toCategoryBarRows([
        { category: "system_prompt", costUsd: 0.75, tokens: 750 },
        { category: "thinking", costUsd: 0.25, tokens: 250 },
      ]);

      const byCat = new Map(rows.map((r) => [r.category, r]));
      expect(byCat.get("system_prompt")?.sharePct).toBeCloseTo(75, 10);
      expect(byCat.get("thinking")?.sharePct).toBeCloseTo(25, 10);
      // Human label is attached from the taxonomy, never the raw wire enum.
      expect(byCat.get("system_prompt")?.label).toBe("System prompt");
    });
  });

  describe("given rows whose costs all sum to zero", () => {
    it("returns 0% shares instead of dividing by zero", () => {
      const rows = toCategoryBarRows([
        { category: "system_prompt", costUsd: 0, tokens: 500 },
        { category: "user_input", costUsd: 0, tokens: 300 },
      ]);

      for (const row of rows) {
        expect(row.sharePct).toBe(0);
        expect(Number.isNaN(row.sharePct)).toBe(false);
      }
      // Tokens are preserved even when cost is zero.
      expect(rows.map((r) => r.tokens)).toEqual([500, 300]);
    });
  });

  describe("given no rows", () => {
    it("returns an empty array", () => {
      expect(toCategoryBarRows([])).toEqual([]);
    });
  });
});
