/**
 * The From LangWatch boards: the three named templates, live, with every widget's code, and a
 * library card for each.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { CURATED_BOARD_DEFINITIONS } from "@langwatch/analytics-catalogue";
import { describe, expect, it } from "vitest";

import { CURATED_BOARDS, curatedBoardById } from "../model/curated-boards.ts";

describe("CURATED_BOARDS", () => {
  /** @scenario "AC161 The sidebar lists Your dashboards, Pinned and From LangWatch in order" */
  it("is Release check, Can I trust my numbers? and Where my agent breaks, in that order", () => {
    expect(CURATED_BOARDS.map(({ name }) => name)).toEqual([
      "Release check",
      "Can I trust my numbers?",
      "Where my agent breaks",
    ]);
  });

  /** @scenario "From LangWatch: every widget on a template board has code" */
  it("lays out every widget of each template with its code, the Trust widgets included", () => {
    for (const { widgets } of CURATED_BOARDS) {
      expect(widgets.every(({ definition }) => definition.code.length > 0)).toBe(true);
    }
    expect(curatedBoardById("data")?.widgets.map(({ key }) => key)).toEqual([
      "data-health",
      "cost-accuracy",
      "noise",
      "evaluation-coverage",
    ]);
    expect(curatedBoardById("unknown")).toBeUndefined();
  });
});

describe("the From LangWatch boards", () => {
  describe("given every catalogue board", () => {
    // The server runs daily insights on every catalogue board, so a board the browser drops
    // for want of a card would get insights whose links read as deleted.
    it("gives each one a library card", () => {
      expect(CURATED_BOARDS.map(({ templateId }) => templateId)).toEqual(
        CURATED_BOARD_DEFINITIONS.map(({ templateId }) => templateId),
      );
    });
  });
});
