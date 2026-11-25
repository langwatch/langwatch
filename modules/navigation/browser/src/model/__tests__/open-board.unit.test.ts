/**
 * Which board a Dashboards address opens, so the shell can draw the board's home product.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { describe, expect, it } from "vitest";

import { isOrganizationCuratedPath, openBoardIdAt } from "../open-board.ts";

describe("openBoardIdAt", () => {
  it.each([
    { pathname: "/dashboards/board_1", id: "board_1" },
    { pathname: "/dashboards/board_1/", id: "board_1" },
    { pathname: "/shop/dashboards/board_1", id: "board_1" },
  ])("reads the board id of $pathname", ({ pathname, id }) => {
    expect(openBoardIdAt(pathname)).toBe(id);
  });

  it.each([
    "/dashboards",
    "/dashboards/templates",
    "/dashboards/curated/release",
    "/shop/dashboards",
    "/shop/dashboards/templates",
    "/shop/dashboards/curated/release",
    "/shop/traces/abc",
    "/gateway/virtual-keys",
  ])("names no board at %s", (pathname) => {
    expect(openBoardIdAt(pathname)).toBeNull();
  });
});

describe("isOrganizationCuratedPath", () => {
  it("knows a From LangWatch board at the organization level from one in a project", () => {
    expect(isOrganizationCuratedPath("/dashboards/curated/release")).toBe(true);
    expect(isOrganizationCuratedPath("/shop/dashboards/curated/release")).toBe(false);
  });
});
