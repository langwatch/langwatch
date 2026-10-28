/**
 * What Undo writes to put a board back as it was: one plan for every kind of change.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { describe, expect, it } from "vitest";

import { boardRestorePlan } from "../model/board-restore.ts";
import type { BoardWidget } from "../model/board-widgets.ts";

const widget = ({
  id,
  gridRow = 0,
  code = "export default function Widget() { return null; }",
  excludedOrigins,
}: {
  id: string;
  gridRow?: number;
  code?: string;
  excludedOrigins?: string[];
}): BoardWidget => ({
  id,
  name: `Widget ${id}`,
  definition: {
    version: 1,
    code,
    queries: [{ name: "main", sql: "SELECT 1" }],
    ...(excludedOrigins ? { excludedOrigins } : {}),
  },
  placement: { graphId: id, gridColumn: 0, gridRow, colSpan: 4, rowSpan: 3 },
});

const BEFORE = [widget({ id: "a" }), widget({ id: "b", gridRow: 3 })];

describe("boardRestorePlan", () => {
  describe("given a board that did not change", () => {
    /** @scenario "Undo: the restore plan puts the board back as it was" */
    it("needs no write", () => {
      expect(boardRestorePlan({ before: BEFORE, now: BEFORE })).toEqual({
        remove: [],
        recreate: [],
        revert: [],
        layouts: [],
      });
    });
  });

  describe("given a widget was added and another deleted since", () => {
    /** @scenario "Undo: the restore plan puts the board back as it was" */
    it("removes the added one and makes the deleted one again at its old place", () => {
      const plan = boardRestorePlan({ before: BEFORE, now: [BEFORE[0]!, widget({ id: "c" })] });

      expect(plan.remove).toEqual(["c"]);
      expect(plan.recreate).toEqual([BEFORE[1]]);
      expect(plan.revert).toEqual([]);
      expect(plan.layouts).toEqual([]);
    });
  });

  describe("given a widget was edited and another moved since", () => {
    /** @scenario "Undo: the restore plan puts the board back as it was" */
    it("reverts the edit and puts the moved one back", () => {
      const plan = boardRestorePlan({
        before: BEFORE,
        now: [widget({ id: "a", code: "edited" }), widget({ id: "b", gridRow: 0 })],
      });

      expect(plan.revert).toEqual([BEFORE[0]]);
      expect(plan.layouts).toEqual([BEFORE[1]!.placement]);
      expect(plan.remove).toEqual([]);
      expect(plan.recreate).toEqual([]);
    });
  });

  describe("given only a widget's Langy setting changed since", () => {
    /** @scenario "AC200k Langy setting: Undo puts the setting back, including back to none" */
    it("reverts it, whether it was set, changed or not stored before", () => {
      const plan = (before: BoardWidget, now: BoardWidget) =>
        boardRestorePlan({ before: [before], now: [now] }).revert;
      const none = widget({ id: "a" });
      const included = widget({ id: "a", excludedOrigins: [] });

      expect(plan(none, included)).toEqual([none]);
      expect(plan(included, none)).toEqual([included]);
      expect(plan(included, widget({ id: "a", excludedOrigins: ["langy"] }))).toEqual([included]);
      expect(plan(included, included)).toEqual([]);
    });
  });
});
