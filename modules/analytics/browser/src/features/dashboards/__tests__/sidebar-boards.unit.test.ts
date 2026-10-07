/**
 * The sidebar puts each board in exactly one group: My dashboard, the team's boards by
 * name, the member's stars in their order, then the From LangWatch boards not starred.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { type SidebarBoard, sameStar, sidebarGroups, starRefOf } from "../model/sidebar-boards.ts";

const board = (id: string, name: string, createdById = "user-1"): SidebarBoard => ({
  id,
  name,
  description: null,
  createdById,
});
const MINE = board("mine", "My dashboard");
const THEIRS = board("theirs", "My dashboard", "user-2");
const BOARDS = [board("b-2", "Weekly review"), THEIRS, MINE, board("b-1", "Latency")];

describe("sidebarGroups", () => {
  describe("given no stars", () => {
    /** @scenario "AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name" */
    it("puts My dashboard first and the team's boards by name, leaving out others' My dashboards", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        stars: [],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect(groups.myBoard).toEqual(MINE);
      expect(groups.yourBoards.map(({ name }) => name)).toEqual(["Latency", "Weekly review"]);
      expect(groups.starred).toEqual([]);
      expect(groups.fromLangWatch.map(({ templateId }) => templateId)).toEqual([
        "release",
        "data",
        "breaks",
      ]);
    });
  });

  describe("given stars on a board and on a From LangWatch board", () => {
    /** @scenario "AC161c Starred shows only when the member has stars, in their own order" */
    it("lists them once, under Starred, in the member's order", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        stars: [
          { kind: "template", templateId: "data" },
          { kind: "board", board: board("b-2", "Weekly review") },
          { kind: "board", board: MINE },
          { kind: "template", templateId: "gone" },
        ],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect(groups.starred.map(starRefOf)).toEqual([
        { kind: "template", templateId: "data" },
        { kind: "board", dashboardId: "b-2" },
      ]);
      expect(groups.yourBoards.map(({ id }) => id)).toEqual(["b-1"]);
      expect(groups.myBoard).toEqual(MINE);
      expect(groups.fromLangWatch.map(({ templateId }) => templateId)).toEqual([
        "release",
        "breaks",
      ]);
    });
  });
});

describe("sameStar", () => {
  /** @scenario "AC165 A star can point at a From LangWatch board" */
  it("tells a board star from a template star with the same id", () => {
    expect(
      sameStar({ kind: "template", templateId: "x" }, { kind: "template", templateId: "x" }),
    ).toBe(true);
    expect(
      sameStar({ kind: "board", dashboardId: "x" }, { kind: "template", templateId: "x" }),
    ).toBe(false);
  });
});
