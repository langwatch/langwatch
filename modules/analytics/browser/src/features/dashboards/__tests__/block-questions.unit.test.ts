/**
 * The picker's questions, the prompts they ask Langy, and how a block is stored on a board.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { findBlock, LIBRARY_BLOCKS } from "../blocks/index.ts";
import * as blockQueries from "../blocks/model/block-queries.ts";
import { boardPromptQuestion, FLIGHT_DECK_SUBJECT } from "../langy/model/board-langy.ts";
import { BLOCK_QUESTION_SECTIONS, searchBlockQuestions } from "../model/block-questions.ts";
import {
  blockOfWidgetCode,
  blockWidgetDefinition,
  boardBlocksOf,
  nextBlockSlot,
} from "../model/board-blocks.ts";

const every = BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions);

/** Every LangWatchQL view the shipped block queries read, so a prompt names only real views. */
const QUERIED_VIEWS = new Set(
  Object.values(blockQueries)
    .filter((value): value is string => typeof value === "string")
    .flatMap((sql) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((match) => match[1])),
);

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400,
};

describe("the picker's questions", () => {
  describe("given the picker is open", () => {
    /** @scenario "AC12 Only working questions are offered" */
    it("gives every question its own prompt that names the dashboard period", () => {
      expect(every.length).toBeGreaterThan(0);
      for (const { question, prompt } of every) {
        expect(prompt.startsWith(question)).toBe(true);
        expect(prompt).toContain("dashboard period");
        expect(prompt).toContain("no data");
      }
      expect(new Set(every.map(({ prompt }) => prompt)).size).toBe(every.length);
    });

    /** @scenario "AC12 Only working questions are offered" */
    it("keeps every prompt tight and points it at a view the block queries read", () => {
      for (const { prompt } of every) {
        expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(120);
        expect([...QUERIED_VIEWS].some((view) => prompt.includes(view))).toBe(true);
      }
    });

    /** @scenario "AC11 Ask Langy by question" */
    it("asks Langy the prompt with the concrete period and grain and the board attached", () => {
      const [first] = every;
      const request = boardPromptQuestion({
        prompt: first!.prompt,
        board: FLIGHT_DECK_SUBJECT,
        period: PERIOD,
      });

      expect(request.question.startsWith(first!.prompt)).toBe(true);
      expect(request.question).toContain(
        "Dashboard period: 2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z",
      );
      expect(request.question).toContain("one bucket per 1 day");
      expect(request.context[0]?.ref).toContain("read-only");
    });

    it("ships How do I… as its own section", () => {
      expect(BLOCK_QUESTION_SECTIONS.map(({ title }) => title)).toContain("How do I…?");
    });

    it("gives every question a unique id", () => {
      expect(new Set(every.map(({ id }) => id)).size).toBe(every.length);
    });

    /** @scenario "AC12 Only working questions are offered" */
    it("stores every library block in a form the board reads back as that block", () => {
      for (const block of LIBRARY_BLOCKS) {
        const { code, queries } = blockWidgetDefinition({ block });
        expect(blockOfWidgetCode(code)?.id).toBe(block.id);
        expect(queries).toEqual(block.queries);
      }
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
