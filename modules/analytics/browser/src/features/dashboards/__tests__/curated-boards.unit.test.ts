/**
 * The From LangWatch boards are the three named templates, live. A widget with no query yet
 * is marked not built and carries no code, so it can never show numbers.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS, curatedBoardById, curatedCopyWidgets } from "../model/curated-boards.ts";

describe("CURATED_BOARDS", () => {
  /** @scenario "AC161 The sidebar lists Your dashboards, Starred, From LangWatch and Browse templates in order" */
  it("is Release check, Can I trust my numbers? and Where my agent breaks, in that order", () => {
    expect(CURATED_BOARDS.map(({ name }) => name)).toEqual([
      "Release check",
      "Can I trust my numbers?",
      "Where my agent breaks",
    ]);
  });

  /** @scenario "From LangWatch: a widget with no query yet shows as not built, with no numbers" */
  it("marks the widgets with no query as not built, with no code to run", () => {
    const notBuilt = CURATED_BOARDS.flatMap(({ templateId, widgets }) =>
      widgets.flatMap((widget) => (widget.kind === "not-built" ? [{ templateId, widget }] : [])),
    );

    expect(notBuilt.map(({ widget }) => widget.key).toSorted((a, b) => a.localeCompare(b))).toEqual(
      ["cost-accuracy", "data-health", "noise"],
    );
    expect(new Set(notBuilt.map(({ templateId }) => templateId))).toEqual(new Set(["data"]));
    expect(notBuilt.filter(({ widget }) => "widget" in widget)).toEqual([]);
  });

  /** @scenario "From LangWatch: Duplicate to edit makes an own board named after the template" */
  it("copies only the built widgets when duplicated", () => {
    const data = curatedBoardById("data")!;
    const built = data.widgets.filter(({ kind }) => kind === "built");

    expect(curatedCopyWidgets(data)).toHaveLength(built.length);
    expect(curatedBoardById("unknown")).toBeUndefined();
  });
});
