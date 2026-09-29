/**
 * The picker's questions, the prompts they ask Langy, and how a board reads its stored widgets.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { boardPromptQuestion, boardSubject } from "../langy/model/board-langy.ts";
import { BLOCK_QUESTION_SECTIONS, searchBlockQuestions } from "../model/block-questions.ts";
import { BOARD_LWQL_VIEWS } from "../model/board-lwql-views.ts";
import { addedWidgetSlots, boardWidgetsOf, duplicateSlot } from "../model/board-widgets.ts";

const every = BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions);

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400 as const,
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
    it("keeps every prompt tight and points it at a real LangWatchQL view", () => {
      for (const { prompt } of every) {
        expect(prompt.split(/\s+/).length).toBeLessThanOrEqual(120);
        expect(BOARD_LWQL_VIEWS.some((view) => prompt.includes(view))).toBe(true);
      }
    });

    /** @scenario "AC11 Ask Langy by question" */
    it("asks Langy the prompt with the concrete period and grain and the board attached", () => {
      const [first] = every;
      const request = boardPromptQuestion({
        prompt: first!.prompt,
        board: boardSubject({
          board: { id: "board-1", name: "Weekly review" },
          widgets: [{ name: "Status" }],
        }),
        period: PERIOD,
      });

      expect(request.question?.startsWith(first!.prompt)).toBe(true);
      expect(request.question).toContain(
        "Dashboard period: 2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z",
      );
      expect(request.question).toContain("one bucket per 1 day");
      expect(request.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
      expect(request.context[0]?.ref).toContain("widgets: Status");
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

describe("widgets on a board", () => {
  const definition = { version: 1 as const, code: "export default () => null;", queries: [] };
  const stored = (id: string, dashboardId: string, gridRow: number, gridColumn: number) => ({
    id,
    name: `Widget ${id}`,
    dashboardId,
    gridColumn,
    gridRow,
    colSpan: 4,
    rowSpan: 3,
    graph: definition,
  });

  /** @scenario "AC15 Widget menu actions persist after reload" */
  it("reads only this board's widgets, top to bottom and left to right", () => {
    const widgets = boardWidgetsOf({
      dashboardId: "board-1",
      widgets: [
        stored("c", "board-1", 3, 0),
        stored("b", "board-2", 0, 0),
        stored("a2", "board-1", 0, 4),
        stored("a1", "board-1", 0, 0),
      ],
    });

    expect(widgets.map(({ id }) => id)).toEqual(["a1", "a2", "c"]);
    expect(widgets[0]).toMatchObject({ name: "Widget a1", definition });
  });

  /** @scenario "AC15 Widget menu actions persist after reload" */
  it("lands a copy at the bottom of the board at the original's size", () => {
    const original = { graphId: "a", gridColumn: 4, gridRow: 0, colSpan: 4, rowSpan: 3 };
    const below = { graphId: "b", gridColumn: 0, gridRow: 3, colSpan: 8, rowSpan: 2 };

    expect(duplicateSlot({ placements: [original, below], original })).toEqual({
      gridColumn: 0,
      gridRow: 5,
      colSpan: 4,
      rowSpan: 3,
    });
  });

  /** @scenario "AC12 A picked question adds its widget and seeds Langy" */
  it("drops added widgets flush below the board's bottom row, keeping their relative layout", () => {
    const existing = [{ graphId: "a", gridColumn: 0, gridRow: 0, colSpan: 8, rowSpan: 3 }];
    // Two template widgets that start at row 4, side by side, then one below at row 8.
    const widgets = [
      { layout: { gridColumn: 0, gridRow: 4, colSpan: 4, rowSpan: 4 } },
      { layout: { gridColumn: 4, gridRow: 4, colSpan: 4, rowSpan: 4 } },
      { layout: { gridColumn: 0, gridRow: 8, colSpan: 4, rowSpan: 4 } },
    ];

    expect(addedWidgetSlots({ placements: existing, widgets })).toEqual([
      { gridColumn: 0, gridRow: 3, colSpan: 4, rowSpan: 4 },
      { gridColumn: 4, gridRow: 3, colSpan: 4, rowSpan: 4 },
      { gridColumn: 0, gridRow: 7, colSpan: 4, rowSpan: 4 },
    ]);
  });

  /** @scenario "AC12b Without Langy a picked question still adds its widget" */
  it("places a single added widget at the top of an empty board", () => {
    expect(
      addedWidgetSlots({
        placements: [],
        widgets: [{ layout: { gridColumn: 0, gridRow: 3, colSpan: 8, rowSpan: 6 } }],
      }),
    ).toEqual([{ gridColumn: 0, gridRow: 0, colSpan: 8, rowSpan: 6 }]);
  });
});
