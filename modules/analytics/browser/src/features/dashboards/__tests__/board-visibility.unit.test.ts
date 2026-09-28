/**
 * Who may change a board's visibility, and how the sidebar groups boards by
 * it. @see modules/dashboard/specs/dashboards-v1.feature
 */

import { describe, expect, it } from "vitest";

import { boardVisibilityGroups, canChangeBoardVisibility } from "../model/board-visibility.ts";

describe("canChangeBoardVisibility", () => {
  /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
  it.each([
    ["the creator", { createdById: "user-1", userId: "user-1", isAdmin: false }, true],
    ["an admin", { createdById: "user-2", userId: "user-1", isAdmin: true }, true],
    ["another member", { createdById: "user-2", userId: "user-1", isAdmin: false }, false],
    [
      "anyone, on a board older than creators",
      { createdById: null, userId: "user-1", isAdmin: false },
      true,
    ],
  ] as const)("answers %s", (_who, input, allowed) => {
    expect(canChangeBoardVisibility(input)).toBe(allowed);
  });
});

describe("boardVisibilityGroups", () => {
  /** @scenario "AC18 Visibility hides a board from members outside its audience" */
  it("groups Mine, Team and Organisation, leaving out an empty shared group", () => {
    const groups = boardVisibilityGroups([
      { id: "a", visibility: "organisation" as const },
      { id: "b", visibility: "only_me" as const },
    ]);
    expect(groups.map(({ label, boards }) => [label, boards.map(({ id }) => id)])).toEqual([
      ["Mine", ["b"]],
      ["Organisation", ["a"]],
    ]);
  });
});
