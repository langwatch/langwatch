/**
 * The From LangWatch boards are the three named templates, live, and every widget on them
 * has code: none is a placeholder.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS, curatedBoardById } from "../model/curated-boards.ts";

describe("CURATED_BOARDS", () => {
  /** @scenario "AC161 The sidebar lists Your dashboards, Pinned and From LangWatch in order" */
  it("is Ready to ship?, Fix missing data and Errors and failures, in that order", () => {
    expect(CURATED_BOARDS.map(({ name }) => name)).toEqual([
      "Ready to ship?",
      "Fix missing data",
      "Errors and failures",
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
