/**
 * A kept pointer looked up against the boards and widgets that exist now: what still
 * links, and what only keeps its name.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { resolveDashboardPointer } from "../model/dashboard-pointer.ts";

const POINTER = {
  boardId: "board-1",
  boardName: "Checkout health",
  widget: { id: "widget-1", name: "Errors by day" },
};
const BOARD = { id: "board-1", name: "Checkout health" };
const WIDGET = { id: "widget-1", name: "Errors by day", dashboardId: "board-1" };
const HREF = "/acme/dashboards/board-1";

function resolve({
  pointer = POINTER,
  boards,
  widgets,
}: {
  pointer?: typeof POINTER | { boardId: string; boardName: string };
  boards: readonly (typeof BOARD)[] | undefined;
  widgets: readonly (typeof WIDGET)[] | undefined;
}) {
  return resolveDashboardPointer({
    pointer,
    boards,
    widgets,
    curated: CURATED_BOARDS,
    projectSlug: "acme",
  });
}

describe("given a pointer to a widget on a board", () => {
  describe("when the board and the widget still exist", () => {
    it("links both to the board", () => {
      expect(resolve({ boards: [BOARD], widgets: [WIDGET] })).toEqual({
        board: { name: "Checkout health", href: HREF, deleted: false },
        widget: { name: "Errors by day", href: HREF, deleted: false },
      });
    });

    it("shows the names they have now, not the ones that were kept", () => {
      const renamed = resolve({
        boards: [{ ...BOARD, name: "Checkout" }],
        widgets: [{ ...WIDGET, name: "Daily errors" }],
      });

      expect([renamed.board.name, renamed.widget?.name]).toEqual(["Checkout", "Daily errors"]);
    });
  });

  describe("when the board was deleted", () => {
    it("keeps the board's name as deleted and the widget's name as plain text", () => {
      expect(resolve({ boards: [], widgets: [] })).toEqual({
        board: { name: "Checkout health", deleted: true },
        widget: { name: "Errors by day", deleted: false },
      });
    });
  });

  describe("when the widget was removed, or moved to another board", () => {
    it("still links the board and keeps the widget's name as deleted", () => {
      for (const widgets of [[], [{ ...WIDGET, dashboardId: "board-2" }]]) {
        expect(resolve({ boards: [BOARD], widgets })).toEqual({
          board: { name: "Checkout health", href: HREF, deleted: false },
          widget: { name: "Errors by day", deleted: true },
        });
      }
    });
  });

  describe("when the boards or the widgets are not known yet", () => {
    it("never calls a name deleted", () => {
      expect(resolve({ boards: undefined, widgets: undefined })).toEqual({
        board: { name: "Checkout health", deleted: false },
        widget: { name: "Errors by day", deleted: false },
      });
      expect(resolve({ boards: [BOARD], widgets: undefined }).widget).toEqual({
        name: "Errors by day",
        deleted: false,
      });
    });
  });
});

describe("given a pointer to a From LangWatch board", () => {
  const [curated] = CURATED_BOARDS;

  describe("when the board still ships", () => {
    it("links it at its own address, with no list of stored boards needed", () => {
      if (!curated) throw new Error("No From LangWatch board ships");
      const resolved = resolve({
        pointer: { boardId: `curated/${curated.templateId}`, boardName: "As it was called" },
        boards: undefined,
        widgets: undefined,
      });

      expect(resolved).toEqual({
        board: {
          name: curated.name,
          href: `/acme/dashboards/curated/${curated.templateId}`,
          deleted: false,
        },
      });
    });
  });

  describe("when the board no longer ships", () => {
    it("keeps its name as deleted", () => {
      const resolved = resolve({
        pointer: { boardId: "curated/retired", boardName: "Retired board" },
        boards: [],
        widgets: [],
      });

      expect(resolved).toEqual({ board: { name: "Retired board", deleted: true } });
    });
  });
});
