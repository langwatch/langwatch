/**
 * The board `/[project]/dashboards` opens. @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { landingBoardId } from "../model/boards.ts";

const BOARDS = [
  { id: "shared", createdById: "user-2" },
  { id: "own", createdById: "user-1" },
  { id: "picked", createdById: "user-2" },
];

describe("landingBoardId", () => {
  /** @scenario "AC109b Sidebar menu: Set as default picks the board the area opens on" */
  it("opens the member's default while it exists", () => {
    expect(landingBoardId({ boards: BOARDS, userId: "user-1", defaultBoardId: "picked" })).toBe(
      "picked",
    );
  });

  /** @scenario "AC109b Sidebar menu: Set as default picks the board the area opens on" */
  it("falls back to the member's first own board once the default is gone", () => {
    expect(landingBoardId({ boards: BOARDS, userId: "user-1", defaultBoardId: "deleted" })).toBe(
      "own",
    );
  });
});
