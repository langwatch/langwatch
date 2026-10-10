/**
 * The sidebar puts each board in exactly one group: My dashboard, the team's boards by
 * name, the member's stars in their order, the organization's boards other projects own,
 * then the From LangWatch boards not starred.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CURATED_BOARDS } from "../model/curated-boards.ts";
import {
  type SidebarBoard,
  sameStar,
  sidebarGroups,
  starredLinks,
  starRefOf,
} from "../model/sidebar-boards.ts";

const board = (id: string, name: string, createdById = "user-1"): SidebarBoard => ({
  id,
  projectId: "proj-1",
  name,
  description: null,
  createdById,
  scope: "PROJECT",
  organizationId: null,
  ownerProject: null,
});
/** An Organization board another project owns, as this project lists it. */
const shared = (id: string, name: string): SidebarBoard => ({
  ...board(id, name, "user-9"),
  projectId: "proj-2",
  scope: "ORGANIZATION",
  organizationId: "org-1",
  ownerProject: { name: "Checkout" },
});
const MINE = { ...board("mine", "My dashboard"), scope: "PRIVATE" as const };
/** Another member's My dashboard, which the server lists only once its author widened it. */
const THEIRS = board("theirs", "My dashboard", "user-2");
const BOARDS = [board("b-2", "Weekly review"), THEIRS, MINE, board("b-1", "Latency")];
const SHARED = [shared("s-2", "Spend by team"), shared("s-1", "Quality")];

describe("sidebarGroups", () => {
  describe("given no stars", () => {
    /** @scenario "AC161b Your dashboards: My dashboard first, then the team's unstarred boards by name" */
    it("puts My dashboard first and the team's boards by name, a widened My dashboard of another member among them", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        stars: [],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect(groups.myBoard).toEqual(MINE);
      expect(groups.yourBoards.map(({ id }) => id)).toEqual(["b-1", "theirs", "b-2"]);
      expect(groups.starred).toEqual([]);
      expect(groups.fromLangWatch.map(({ templateId }) => templateId)).toEqual([
        "release",
        "data",
        "breaks",
      ]);
    });
  });

  describe("given stars on a board and on a From LangWatch board", () => {
    /** @scenario "AC161c Starred shows only when the member has stars, in their own order" */
    it("lists them once, under Starred, in the member's order", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        stars: [
          { kind: "template", templateId: "data" },
          { kind: "board", board: board("b-2", "Weekly review") },
          { kind: "board", board: MINE },
          { kind: "template", templateId: "gone" },
        ],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect(groups.starred.map(starRefOf)).toEqual([
        { kind: "template", templateId: "data" },
        { kind: "board", dashboardId: "b-2" },
      ]);
      expect(groups.yourBoards.map(({ id }) => id)).toEqual(["b-1", "theirs"]);
      expect(groups.myBoard).toEqual(MINE);
      expect(groups.fromLangWatch.map(({ templateId }) => templateId)).toEqual([
        "release",
        "breaks",
      ]);
    });
  });
});

describe("sidebarGroups with the organization's boards", () => {
  describe("given Organization boards other projects own", () => {
    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("lists them in their own group, by name, apart from the project's own", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        organizationBoards: SHARED,
        stars: [],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect({
        fromOrganization: groups.fromOrganization.map(({ name }) => name),
        yours: groups.yourBoards.map(({ id }) => id),
      }).toEqual({
        fromOrganization: ["Quality", "Spend by team"],
        yours: ["b-1", "theirs", "b-2"],
      });
    });

    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("moves one the member starred to Starred, keeping the name of the project that owns it", () => {
      const [spend] = SHARED;
      const groups = sidebarGroups({
        boards: BOARDS,
        organizationBoards: SHARED,
        // A star's own row names no owner project; the listed row does.
        stars: [{ kind: "board", board: { ...spend!, ownerProject: null } }],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect({
        starred: groups.starred,
        fromOrganization: groups.fromOrganization.map(({ id }) => id),
      }).toEqual({ starred: [{ kind: "board", board: spend }], fromOrganization: ["s-1"] });
    });

    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("never takes another project's My dashboard for the member's own", () => {
      const elsewhere = { ...shared("s-mine", "My dashboard"), createdById: "user-1" };
      const groups = sidebarGroups({
        boards: [board("b-1", "Latency")],
        organizationBoards: [elsewhere],
        stars: [],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect({ mine: groups.myBoard, fromOrganization: groups.fromOrganization }).toEqual({
        mine: void 0,
        fromOrganization: [elsewhere],
      });
    });
  });

  describe("given no board from another project", () => {
    /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
    it("has no such group", () => {
      const groups = sidebarGroups({
        boards: BOARDS,
        stars: [],
        curated: CURATED_BOARDS,
        userId: "user-1",
      });

      expect(groups.fromOrganization).toEqual([]);
    });
  });
});

describe("sameStar", () => {
  /** @scenario "AC165 A star can point at a From LangWatch board" */
  it("tells a board star from a template star with the same id", () => {
    expect(
      sameStar({ kind: "template", templateId: "x" }, { kind: "template", templateId: "x" }),
    ).toBe(true);
    expect(
      sameStar({ kind: "board", dashboardId: "x" }, { kind: "template", templateId: "x" }),
    ).toBe(false);
  });
});

describe("starredLinks", () => {
  /** @scenario "Starred dashboards show in the other products' sidebars" */
  it("links every star in the member's order, My dashboard included, into Dashboards", () => {
    const links = starredLinks({
      stars: [
        { kind: "template", templateId: "release" },
        { kind: "board", board: MINE },
        { kind: "template", templateId: "no-longer-offered" },
        { kind: "board", board: board("b 2", "Weekly review") },
      ],
      curated: CURATED_BOARDS,
      projectSlug: "demo",
    });

    expect(links.map(({ name, href }) => ({ name, href }))).toEqual([
      {
        name: CURATED_BOARDS.find(({ templateId }) => templateId === "release")!.name,
        href: "/demo/dashboards/curated/release",
      },
      { name: "My dashboard", href: "/demo/dashboards/mine" },
      { name: "Weekly review", href: "/demo/dashboards/b%202" },
    ]);
  });
});
