/**
 * The sample rows for the panels that lead with a token count.
 *
 * SAMPLE MUST NOT TEACH A LAYOUT THE REAL SCREEN NEVER DRAWS. `CostRankList`
 * picks its row shape from the rows themselves: a list where some row carries
 * a `secondary` line is drawn two lines high, and one where none does keeps
 * the single line the money panels have always drawn. A measured department
 * row always carries one, so a sample row without it put the department and
 * people panels into a shape the real screen has no way of producing — and
 * the reader learning the page from sample data learns the wrong one.
 */
import { describe, expect, it } from "vitest";

import { sampleTokenRows } from "../sampleLanes";
import { tokenRowSecondaryLine } from "../tokenRowSecondary";

describe("the sample rows of a panel that leads with tokens", () => {
  describe("given invented money rows scaled into token counts", () => {
    const rows = sampleTokenRows([
      { key: "Engineering", label: "Engineering", value: 300 },
      { key: "Marketing", label: "Marketing", value: 90 },
    ]);

    it("leads with a token count rather than the dollars it was scaled from", () => {
      // Three dollars to the million, so the count is the money's own order of
      // magnitude times a hundred thousand — anything near 300 would mean the
      // row is still ranking money under a token heading.
      expect(rows[0]?.value).toBeGreaterThan(1_000_000);
    });

    it("carries the second line a measured row carries, in the same words", () => {
      for (const row of rows) {
        expect(row.secondary).toBeDefined();
      }
      expect(rows[0]?.secondary).toBe(
        tokenRowSecondaryLine({ spendUsd: "300", hasEstimatedTokens: false }),
      );
      expect(rows[0]?.secondary).toBe("$300.00 per-request cost");
    });

    it("never marks its tokens estimated, which would claim a measurement", () => {
      for (const row of rows) {
        expect(row.secondary).not.toContain("estimated");
      }
    });
  });
});
