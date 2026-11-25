/**
 * How a trace row's status and selection show in its border and tint.
 * @see specs/traces-v2/trace-table.feature
 */
import { describe, expect, it } from "vitest";

import { ROW_STYLES, rowVariantFor } from "../status-row.tsx";
import { cellPropsFor } from "../trace-table-shell.tsx";

const firstCell = (variant: keyof typeof ROW_STYLES) =>
  cellPropsFor({
    cell: { column: { id: "time", getSize: () => 60, columnDef: { size: 60, minSize: 60 } } },
    leftBorderColor: ROW_STYLES[variant].borderColor,
    index: 0,
  });

describe("a trace row's status styling", () => {
  describe("given a trace with OK status", () => {
    /** @scenario OK status has no visual indicator */
    it("paints no left border and no background tint", () => {
      const style = ROW_STYLES[rowVariantFor({ isSelected: false, status: "ok" })];

      expect(style.borderColor).toBe("transparent");
      expect(style.bg).toBe("transparent");
    });
  });

  describe("given a trace with warning status", () => {
    /** @scenario Warning status shows yellow border and tint */
    it("paints a 2px yellow left border and a faint yellow tint", () => {
      const style = ROW_STYLES[rowVariantFor({ isSelected: false, status: "warning" })];

      expect(style.borderColor).toBe("yellow.fg");
      expect(style.bg).toBe("yellow.fg/8");
      expect(firstCell("warning")).toMatchObject({
        borderLeftWidth: "2px",
        borderLeftColor: "yellow.fg",
      });
    });
  });

  describe("given a trace with error status", () => {
    /** @scenario Error status shows red border and tint */
    it("paints a 2px red left border and a faint red tint", () => {
      const style = ROW_STYLES[rowVariantFor({ isSelected: false, status: "error" })];

      expect(style.borderColor).toBe("red.fg");
      expect(style.bg).toBe("red.fg/8");
      expect(firstCell("error")).toMatchObject({
        borderLeftWidth: "2px",
        borderLeftColor: "red.fg",
      });
    });

    /** @scenario Status tint composes with hover state */
    it("keeps the red on hover, deepened, instead of swapping to the neutral hover", () => {
      const hovered = ROW_STYLES[rowVariantFor({ isSelected: false, status: "error" })];

      expect(hovered.hoverBg).toBe("red.fg/14");
      expect(hovered.hoverBg).not.toBe(ROW_STYLES.default.hoverBg);
      expect(hovered.borderColor).toBe("red.fg");
    });
  });

  describe("given a selected row", () => {
    /** @scenario Selected row shows visual indicator */
    it("paints a left border accent and a background tint, whatever its status", () => {
      for (const status of ["ok", "warning", "error"] as const) {
        const style = ROW_STYLES[rowVariantFor({ isSelected: true, status })];

        expect(style.borderColor).toBe("blue.fg");
        expect(style.bg).toBe("blue.subtle");
      }
      expect(firstCell("selected")).toMatchObject({
        borderLeftWidth: "2px",
        borderLeftColor: "blue.fg",
      });
    });
  });
});
