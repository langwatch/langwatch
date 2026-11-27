/**
 * The library's pure rules: where a row opens, and what a board's menu offers the member.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import { MY_DASHBOARD_NAME, untitledBoardName } from "../model/boards.ts";
import {
  boardMenuActions,
  firstUntitledName,
  type BoardMenuHandlers,
  type LibraryBoard,
  libraryBoardPath,
} from "../model/organization-library.ts";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };
const ME = "user-me";

const board = (overrides: Partial<LibraryBoard> = {}): LibraryBoard => ({
  id: "board-1",
  name: "Shop board",
  description: null,
  createdById: "someone",
  ownerName: null,
  scope: "ORGANIZATION",
  homeProduct: "llm-ops",
  project: SHOP,
  openProject: SHOP,
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...overrides,
});

const handlers: BoardMenuHandlers = {
  rename: () => void 0,
  move: () => void 0,
  duplicate: () => void 0,
  delete: () => void 0,
};

const menuOf = (subject: LibraryBoard) =>
  boardMenuActions({
    board: subject,
    userId: ME,
    mayEditInOwner: true,
    mayDeleteInOwner: true,
    on: handlers,
  });

describe("untitledBoardName", () => {
  /** @scenario "AC162i A product sidebar's '+' in a project opens the new board in that project" */
  it("offers the first number no listed board has, as the create dialog does", () => {
    const taken = [MY_DASHBOARD_NAME, "Agent health", "Untitled dashboard 2"];

    expect(untitledBoardName({ takenNames: taken })).toBe("Untitled dashboard 1");
    expect(firstUntitledName(taken)).toBe("Untitled dashboard 1");
    expect(untitledBoardName({ takenNames: [...taken, "Untitled dashboard 1"] })).toBe(
      "Untitled dashboard 3",
    );
  });
});

describe("libraryBoardPath", () => {
  it("is the organization's for every scope, a Project board included", () => {
    expect(libraryBoardPath(board({ scope: "PROJECT" }))).toBe("/dashboards/board-1");
    expect(libraryBoardPath(board({ scope: "ORGANIZATION" }))).toBe("/dashboards/board-1");
    expect(libraryBoardPath(board({ scope: "PRIVATE" }))).toBe("/dashboards/board-1");
  });

  it("is nowhere when no project the member reads shows the board", () => {
    const unopenable = board({ project: null, openProject: null });

    expect(libraryBoardPath(unopenable)).toBeUndefined();
  });
});

describe("boardMenuActions", () => {
  describe("given an ordinary board the member may edit and delete in its project", () => {
    it("offers Rename, Move, Duplicate and an enabled Delete", () => {
      const menu = menuOf(board());

      expect(menu.onRename).toBe(handlers.rename);
      expect(menu.move).toEqual({ onMove: handlers.move });
      expect(menu.onDuplicate).toBe(handlers.duplicate);
      expect(menu.duplicateLabel).toBe("Duplicate");
      expect(menu.remove).toEqual({ onDelete: handlers.delete });
    });
  });

  describe("given the member's own My dashboard", () => {
    /** @scenario "AC163 My dashboard cannot be deleted" */
    it("offers Rename and shows Delete with nothing to run, so it renders disabled", () => {
      const menu = menuOf(
        board({ name: MY_DASHBOARD_NAME, createdById: ME, myDashboardOfUserId: ME }),
      );

      expect(menu.onRename).toBe(handlers.rename);
      expect(menu.move).toEqual({ onMove: handlers.move });
      expect(menu.remove).toEqual({});
    });

    /** @scenario "My dashboard can be renamed and stays the member's My dashboard" */
    it("stays undeletable and renamable once renamed", () => {
      const menu = menuOf(board({ name: "Team pulse", createdById: ME, myDashboardOfUserId: ME }));

      expect(menu.onRename).toBe(handlers.rename);
      expect(menu.remove).toEqual({});
    });

    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("offers no Rename while the step has not marked it, so a new name cannot orphan it", () => {
      const menu = menuOf(board({ name: MY_DASHBOARD_NAME, createdById: ME }));

      expect(menu.onRename).toBeUndefined();
      expect(menu.remove).toEqual({});
    });
  });

  describe("given another member's board named My dashboard", () => {
    it("is an ordinary board, renamed and deleted as any other", () => {
      const menu = menuOf(board({ name: MY_DASHBOARD_NAME, createdById: "someone" }));

      expect(menu.onRename).toBe(handlers.rename);
      expect(menu.remove).toEqual({ onDelete: handlers.delete });
    });
  });
});
