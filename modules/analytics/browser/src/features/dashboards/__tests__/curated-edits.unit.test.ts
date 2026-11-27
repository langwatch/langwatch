/**
 * What a member's own copy of a From LangWatch board is made of after the change they started.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { curatedBoardById } from "../model/curated-boards.ts";
import { changesCurated, curatedCopySource } from "../model/curated-edits.ts";

const RELEASE = curatedBoardById("release")!;
const [FIRST, SECOND] = RELEASE.widgets;

describe("curatedCopySource", () => {
  describe("when the change is a widget dropped somewhere else", () => {
    /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
    it("keeps the moved widget where it was dropped and the rest where they were", () => {
      const dropped = { graphId: FIRST!.key, gridColumn: 6, gridRow: 9, colSpan: 6, rowSpan: 7 };

      const copy = curatedCopySource({
        board: RELEASE,
        edit: { kind: "move", placements: [dropped] },
      });

      expect(copy.widgets[0]?.layout).toEqual({
        gridColumn: 6,
        gridRow: 9,
        colSpan: 6,
        rowSpan: 7,
      });
      expect(copy.widgets[1]?.layout).toEqual(SECOND!.layout);
    });
  });

  describe("when the change deletes a widget", () => {
    /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
    it("leaves that widget out", () => {
      const copy = curatedCopySource({
        board: RELEASE,
        edit: { kind: "removeWidget", key: FIRST!.key },
      });

      expect(copy.widgets.map(({ key }) => key)).toEqual(
        RELEASE.widgets.slice(1).map(({ key }) => key),
      );
    });
  });

  describe("when the change is a new name or description", () => {
    /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
    it("keeps it trimmed on the copy", () => {
      expect(
        curatedCopySource({ board: RELEASE, edit: { kind: "rename", name: "  Ours  " } }).name,
      ).toBe("Ours");
      expect(
        curatedCopySource({ board: RELEASE, edit: { kind: "describe", description: " Why " } }).job,
      ).toBe("Why");
    });
  });

  describe("when the change goes on after the copy opens", () => {
    /** @scenario "From LangWatch: Yes, modify it makes the member's own copy and opens it on their change" */
    it("copies the board as it is", () => {
      const copy = curatedCopySource({ board: RELEASE, edit: { kind: "addWidget" } });

      expect(copy).toEqual({
        templateId: RELEASE.templateId,
        name: RELEASE.name,
        job: RELEASE.job,
        widgets: RELEASE.widgets,
      });
    });
  });
});

describe("changesCurated", () => {
  describe("when the name or description is blank or unchanged", () => {
    /** @scenario "From LangWatch: the first change asks before it makes the member's own copy" */
    it("changes nothing", () => {
      expect(changesCurated({ board: RELEASE, edit: { kind: "rename", name: "  " } })).toBe(false);
      expect(
        changesCurated({ board: RELEASE, edit: { kind: "rename", name: ` ${RELEASE.name} ` } }),
      ).toBe(false);
      expect(
        changesCurated({ board: RELEASE, edit: { kind: "describe", description: RELEASE.job } }),
      ).toBe(false);
    });
  });

  describe("when the change is anything else", () => {
    /** @scenario "From LangWatch: the first change asks before it makes the member's own copy" */
    it("changes the board", () => {
      expect(changesCurated({ board: RELEASE, edit: { kind: "rename", name: "Ours" } })).toBe(true);
      expect(changesCurated({ board: RELEASE, edit: { kind: "removeWidget", key: "x" } })).toBe(
        true,
      );
    });
  });
});
