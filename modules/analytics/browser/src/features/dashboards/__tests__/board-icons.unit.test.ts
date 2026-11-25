/** The icon picker's search and keyboard rules. Spec: dashboard-icons.feature. */
import { DASHBOARD_ICONS } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  BOARD_ICON_COLUMNS,
  boardIconLabel,
  nextBoardIconIndex,
  searchBoardIcons,
} from "../model/board-icons.ts";

describe("searching the board icons", () => {
  /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
  it("lists every icon for a blank search, in list order", () => {
    expect(searchBoardIcons({ query: "  " })).toEqual(DASHBOARD_ICONS);
  });

  /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
  it("finds an icon by its name or by what it is for, whatever the case", () => {
    expect(searchBoardIcons({ query: "CHART" })).toContain("chart-line");
    expect(searchBoardIcons({ query: "money" })).toContain("dollar-sign");
  });

  /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
  it("asks every word of the search to match, and finds nothing for a stranger", () => {
    expect(searchBoardIcons({ query: "chart pie" })).toEqual(["chart-pie"]);
    expect(searchBoardIcons({ query: "zzzz" })).toEqual([]);
  });

  /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
  it("names an icon as a member reads it", () => {
    expect(boardIconLabel("dollar-sign")).toBe("Dollar sign");
  });
});

describe("moving through the icon grid", () => {
  /** @scenario "The grid is reachable by keyboard" */
  it("moves one icon sideways and one row up or down", () => {
    const at = (key: string) => nextBoardIconIndex({ index: 10, key, count: 80 });
    expect([at("ArrowRight"), at("ArrowLeft")]).toEqual([11, 9]);
    expect([at("ArrowDown"), at("ArrowUp")]).toEqual([
      10 + BOARD_ICON_COLUMNS,
      10 - BOARD_ICON_COLUMNS,
    ]);
  });

  /** @scenario "The grid is reachable by keyboard" */
  it("stays put at an edge and for any other key", () => {
    expect(nextBoardIconIndex({ index: 0, key: "ArrowLeft", count: 80 })).toBe(0);
    expect(nextBoardIconIndex({ index: 79, key: "ArrowRight", count: 80 })).toBe(79);
    expect(nextBoardIconIndex({ index: 3, key: "ArrowUp", count: 80 })).toBe(3);
    expect(nextBoardIconIndex({ index: 5, key: "a", count: 80 })).toBe(5);
  });
});
