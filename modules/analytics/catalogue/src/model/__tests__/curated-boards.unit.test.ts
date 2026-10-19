/**
 * The From LangWatch boards are the three named templates, live, and every widget on them
 * has code: none is a placeholder. A server reads them, and each widget, from here alone.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import {
  CURATED_BOARD_DEFINITIONS,
  CURATED_TEMPLATE_IDS,
  curatedBoardDefinitionById,
  curatedBoardWidgetById,
  templateWidgetId,
} from "../curated-boards.ts";

describe("CURATED_BOARD_DEFINITIONS", () => {
  /** @scenario "AC161 The sidebar lists Your dashboards, Starred and From LangWatch in order" */
  it("is Release check, Can I trust my numbers? and Where my agent breaks, in that order", () => {
    expect(CURATED_BOARD_DEFINITIONS.map(({ name }) => name)).toEqual([
      "Release check",
      "Can I trust my numbers?",
      "Where my agent breaks",
    ]);
  });

  /** @scenario "From LangWatch: every widget on a template board has code" */
  it("lays out every widget of each template with its code, the Trust widgets included", () => {
    for (const { widgets } of CURATED_BOARD_DEFINITIONS) {
      expect(widgets.every(({ definition }) => definition.code.length > 0)).toBe(true);
    }
    expect(curatedBoardDefinitionById("data")?.widgets.map(({ key }) => key)).toEqual([
      "data-health",
      "cost-accuracy",
      "noise",
      "evaluation-coverage",
    ]);
    expect(curatedBoardDefinitionById("unknown")).toBeUndefined();
  });

  it.each(CURATED_TEMPLATE_IDS)("resolves %s to widgets that each run a query", (templateId) => {
    const board = curatedBoardDefinitionById(templateId);

    expect(board?.widgets.length).toBeGreaterThan(0);
    for (const { definition } of board?.widgets ?? []) {
      expect(definition.queries.length).toBeGreaterThan(0);
    }
  });
});

describe("curatedBoardWidgetById", () => {
  it("finds each From LangWatch widget by its template widget id", () => {
    for (const { templateId, widgets } of CURATED_BOARD_DEFINITIONS) {
      for (const widget of widgets) {
        const id = templateWidgetId({ templateId, key: widget.key });

        expect(id).toBe(`template:${templateId}:${widget.key}`);
        expect(curatedBoardWidgetById(id)).toEqual({ id, templateId, widget });
      }
    }
  });

  it.each(["template:unknown:noise", "template:data:unknown", "template:data", "data:noise"])(
    "finds nothing for %s",
    (id) => {
      expect(curatedBoardWidgetById(id)).toBeUndefined();
    },
  );
});
