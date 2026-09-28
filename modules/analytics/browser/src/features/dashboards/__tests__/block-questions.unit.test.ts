/**
 * The picker's questions and how a block is stored on a board.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import { LIBRARY_BLOCKS, findBlock } from "../blocks/index.ts";
import { BLOCK_QUESTION_SECTIONS, searchBlockQuestions } from "../model/block-questions.ts";
import {
  blockOfWidgetCode,
  blockWidgetDefinition,
  boardBlocksOf,
  nextBlockSlot,
} from "../model/board-blocks.ts";

const libraryIds = new Set(LIBRARY_BLOCKS.map(({ id }) => id));
const every = BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions);

describe("the picker's questions", () => {
  describe("given the picker is open", () => {
    /** @scenario "AC12 Only working questions are offered" */
    it("maps every listed question in every section to a library block", () => {
      expect(every.length).toBeGreaterThan(0);
      for (const question of every) expect(libraryIds.has(question.blockId)).toBe(true);
    });

    /** @scenario "AC12 Only working questions are offered" */
    it("stores every question's block in a form the board reads back as that block", () => {
      for (const question of every) {
        const block = findBlock(question.blockId)!;
        const { code, queries } = blockWidgetDefinition({ block });
        expect(blockOfWidgetCode(code)?.id).toBe(block.id);
        expect(queries).toEqual(block.queries);
      }
    });

    it("ships How do I… as its own section", () => {
      expect(BLOCK_QUESTION_SECTIONS.map(({ title }) => title)).toContain("How do I…?");
    });

    it("gives every question a unique id", () => {
      expect(new Set(every.map(({ id }) => id)).size).toBe(every.length);
    });
  });

  describe("when the member searches", () => {
    it("keeps only matching questions and drops sections left empty", () => {
      const found = searchBlockQuestions({ sections: BLOCK_QUESTION_SECTIONS, search: "latency" });

      expect(found.every(({ questions }) => questions.length > 0)).toBe(true);
      expect(found.flatMap(({ questions }) => questions.map(({ id }) => id))).toEqual([
        "overall",
        "latency-slo",
        "howto-latency",
      ]);
    });
  });
});

describe("blocks on a board", () => {
  const half = findBlock("trace-count-over-time")!;
  const full = findBlock("previous-period-comparison")!;

  it("reads only this board's block widgets, leaving other widgets out", () => {
    const code = blockWidgetDefinition({ block: half }).code;
    const place = { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 };
    const blocks = boardBlocksOf({
      dashboardId: "board-1",
      widgets: [
        { id: "a", dashboardId: "board-1", ...place, graph: { code } },
        { id: "b", dashboardId: "board-2", ...place, graph: { code } },
        { id: "c", dashboardId: "board-1", ...place, graph: { code: "export default 1" } },
      ],
    });

    expect(blocks.map(({ widgetId }) => widgetId)).toEqual(["a"]);
  });

  it("fills the right half of the last row before starting a new one", () => {
    const left = { graphId: "a", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 };

    expect(nextBlockSlot({ placements: [left], block: half })).toEqual({
      gridColumn: 4,
      gridRow: 0,
      colSpan: 4,
      rowSpan: 4,
    });
    expect(
      nextBlockSlot({ placements: [left, { ...left, graphId: "b", gridColumn: 4 }], block: half }),
    ).toEqual({ gridColumn: 0, gridRow: 4, colSpan: 4, rowSpan: 4 });
  });

  it("puts a full-width block on its own row", () => {
    const left = { graphId: "a", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 };

    expect(nextBlockSlot({ placements: [left], block: full })).toEqual({
      gridColumn: 0,
      gridRow: 4,
      colSpan: 8,
      rowSpan: 3,
    });
  });
});
