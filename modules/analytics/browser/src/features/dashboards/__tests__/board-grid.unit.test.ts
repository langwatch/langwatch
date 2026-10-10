/**
 * A board card is never shorter than its title and its one-row empty face: a shorter
 * placement is clamped, never refused, wherever it is laid out or saved.
 */

import { describe, expect, it } from "vitest";

import { atLeastBoardMinRows, BOARD_MIN_ROW_SPAN } from "../model/board-grid.ts";
import { boardWidgetsOf } from "../model/board-widgets.ts";

const placement = { graphId: "w-1", gridColumn: 0, gridRow: 2, colSpan: 4 };

describe("given a board placement", () => {
  /** @scenario "AC115 Widget fit: a widget is never shorter than its title and one-row empty face" */
  it("raises one shorter than the minimum to the minimum, keeping where it sits", () => {
    expect(BOARD_MIN_ROW_SPAN).toBe(3);
    expect(atLeastBoardMinRows({ ...placement, rowSpan: 1 })).toEqual({
      ...placement,
      rowSpan: BOARD_MIN_ROW_SPAN,
    });
  });

  /** @scenario "AC115 Widget fit: a widget is never shorter than its title and one-row empty face" */
  it("leaves one at or above the minimum as it is", () => {
    expect(atLeastBoardMinRows({ ...placement, rowSpan: 3 }).rowSpan).toBe(3);
    expect(atLeastBoardMinRows({ ...placement, rowSpan: 7 }).rowSpan).toBe(7);
  });

  /** @scenario "AC115 Widget fit: a widget is never shorter than its title and one-row empty face" */
  it("lays out a stored widget saved shorter at the minimum", () => {
    const [widget] = boardWidgetsOf({
      dashboardId: "board-1",
      widgets: [
        {
          id: "w-1",
          name: "Traces",
          dashboardId: "board-1",
          gridColumn: 0,
          gridRow: 0,
          colSpan: 4,
          rowSpan: 2,
          graph: { version: 1, code: "export default () => null;", queries: [] },
        },
      ],
    });

    expect(widget?.placement.rowSpan).toBe(BOARD_MIN_ROW_SPAN);
  });
});
