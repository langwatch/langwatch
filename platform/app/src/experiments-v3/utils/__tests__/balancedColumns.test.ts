import { describe, expect, it } from "vitest";

import { balancedColumns } from "../balancedColumns";

/** Rows the grid actually produces, so assertions read as the layout. */
const rowSizes = (variantCount: number): number[] => {
  const columns = balancedColumns(variantCount);
  const rows: number[] = [];
  for (let remaining = variantCount; remaining > 0; remaining -= columns) {
    rows.push(Math.min(columns, remaining));
  }
  return rows;
};

describe("balancedColumns", () => {
  describe("given a count that divides evenly", () => {
    it("fills every row", () => {
      expect(rowSizes(12)).toEqual([4, 4, 4]);
      expect(rowSizes(9)).toEqual([3, 3, 3]);
      expect(rowSizes(8)).toEqual([4, 4]);
      expect(rowSizes(6)).toEqual([3, 3]);
    });
  });

  describe("given a count smaller than the column cap", () => {
    it("puts them all on one row", () => {
      expect(rowSizes(2)).toEqual([2]);
      expect(rowSizes(3)).toEqual([3]);
      expect(rowSizes(4)).toEqual([4]);
    });
  });

  describe("given a count no column width divides", () => {
    it("leaves the last row as full as it can", () => {
      expect(rowSizes(7)).toEqual([4, 3]);
      expect(rowSizes(11)).toEqual([4, 4, 3]);
      expect(rowSizes(5)).toEqual([3, 2]);
      expect(rowSizes(10)).toEqual([4, 4, 2]);
    });

    // A lone trailing card is only tolerable where it is forced: one more
    // than a common multiple of 3 and 4. Anywhere else it is a layout bug.
    it("orphans a single card only when three and four both leave one over", () => {
      for (let count = 5; count <= 60; count++) {
        const rows = rowSizes(count);
        if (rows[rows.length - 1] === 1) {
          expect(count % 12).toBe(1);
        }
      }
    });
  });

  describe("given zero or one variant", () => {
    it("uses a single column", () => {
      expect(balancedColumns(0)).toBe(1);
      expect(balancedColumns(1)).toBe(1);
    });
  });

  describe("given more than four variants", () => {
    it("stays three or four columns wide, never two", () => {
      for (let count = 5; count <= 60; count++) {
        expect([3, 4]).toContain(balancedColumns(count));
      }
    });
  });
});
