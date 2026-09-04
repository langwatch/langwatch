import { describe, expect, it } from "vitest";
import {
  CHART_GRID_COLUMNS,
  chartGridBottomRow,
  chartGridCardHeightPx,
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "../chartGrid";

describe("chartGrid", () => {
  describe("chartGridBottomRow", () => {
    describe("given cards of different heights", () => {
      it("returns the row just below the card that ends lowest, not the one that starts lowest", () => {
        expect(
          chartGridBottomRow([
            { gridRow: 0, rowSpan: 6 },
            { gridRow: 3, rowSpan: 1 },
          ]),
        ).toBe(6);
      });
    });

    describe("given no cards", () => {
      it("returns row zero", () => {
        expect(chartGridBottomRow([])).toBe(0);
      });
    });
  });

  describe("chartGridCardHeightPx", () => {
    it("covers the rows and the gaps between them", () => {
      expect(chartGridCardHeightPx(1)).toBe(100);
      expect(chartGridCardHeightPx(3)).toBe(332);
    });
  });

  describe("chartGridPlacementSchema", () => {
    describe("when a placement spans the full grid", () => {
      it("accepts it", () => {
        expect(
          chartGridPlacementSchema.safeParse({
            gridColumn: 0,
            gridRow: 0,
            colSpan: CHART_GRID_COLUMNS,
            rowSpan: 20,
          }).success,
        ).toBe(true);
      });
    });

    describe("when a placement starts past the last column, spans more than the grid, or is taller than the ceiling", () => {
      it("refuses each", () => {
        const base = { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };
        expect(
          chartGridPlacementSchema.safeParse({ ...base, gridColumn: 8 })
            .success,
        ).toBe(false);
        expect(
          chartGridPlacementSchema.safeParse({ ...base, colSpan: 9 }).success,
        ).toBe(false);
        expect(
          chartGridPlacementSchema.safeParse({ ...base, rowSpan: 21 }).success,
        ).toBe(false);
        expect(
          chartGridPlacementSchema.safeParse({ ...base, colSpan: 1.5 }).success,
        ).toBe(false);
      });
    });
  });

  describe("fitsChartGridWidth", () => {
    it("refuses a card that would hang past the right edge even though each field is in range", () => {
      expect(fitsChartGridWidth({ gridColumn: 7, colSpan: 2 })).toBe(false);
      expect(fitsChartGridWidth({ gridColumn: 4, colSpan: 4 })).toBe(true);
    });
  });
});
