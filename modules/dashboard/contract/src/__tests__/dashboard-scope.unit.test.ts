/** The rules of a board's scope, one by one. Spec: dashboards-v2.feature AC170 to AC184. */
import { describe, expect, it } from "vitest";

import {
  DASHBOARD_SCOPES,
  MY_DASHBOARD_NAME,
  dashboardScopeChangeAsksFirst,
  dashboardScopeLock,
  dashboardScopeLoss,
  dashboardStanding,
  dashboardsListedFor,
  newDashboardScope,
  type DashboardPlace,
  type DashboardScope,
  type ScopedDashboard,
} from "../index.ts";

const AUTHOR = { userId: "author" };
const TEAMMATE = { userId: "teammate" };
const HOME: DashboardPlace = { projectId: "project-home", organizationId: "organization-1" };
const SIBLING: DashboardPlace = { projectId: "project-sibling", organizationId: "organization-1" };
const STRANGER: DashboardPlace = { projectId: "project-far", organizationId: "organization-2" };

function board(scope: DashboardScope, overrides: Partial<ScopedDashboard> = {}): ScopedDashboard {
  return {
    scope,
    projectId: HOME.projectId,
    organizationId: scope === "ORGANIZATION" ? HOME.organizationId! : null,
    createdById: AUTHOR.userId,
    ...overrides,
  };
}

describe("a board's scope", () => {
  describe("when a board is made", () => {
    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("starts at Project", () => {
      expect(newDashboardScope({ name: "Latency", createdById: AUTHOR.userId })).toBe("PROJECT");
    });

    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("starts a member's My dashboard at Only me", () => {
      expect(newDashboardScope({ name: MY_DASHBOARD_NAME, createdById: AUTHOR.userId })).toBe(
        "PRIVATE",
      );
    });

    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("starts a board made with a project credential at Project, whatever its name", () => {
      expect(newDashboardScope({ name: MY_DASHBOARD_NAME, createdById: void 0 })).toBe("PROJECT");
    });
  });

  describe("when a board is Only me", () => {
    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("stands for its author and for nobody else in its project", () => {
      const standing = (viewer: { userId: string } | undefined) =>
        dashboardStanding({ board: board("PRIVATE"), viewer, place: HOME });

      expect({
        author: standing(AUTHOR),
        teammate: standing(TEAMMATE),
        credential: standing(void 0),
      }).toEqual({ author: "home", teammate: "none", credential: "none" });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is left out of every list but its author's", () => {
      const boards = [board("PRIVATE"), board("PROJECT")];
      const listed = (viewer: { userId: string } | undefined) =>
        dashboardsListedFor({ boards, viewer, place: HOME }).home.map(({ scope }) => scope);

      expect({
        author: listed(AUTHOR),
        teammate: listed(TEAMMATE),
        credential: listed(void 0),
      }).toEqual({
        author: ["PRIVATE", "PROJECT"],
        teammate: ["PROJECT"],
        credential: ["PROJECT"],
      });
    });

    /** @scenario "AC171 Scope: an Only me board exists for its author alone" */
    it("is not shown in another project, even to its author", () => {
      expect(dashboardStanding({ board: board("PRIVATE"), viewer: AUTHOR, place: SIBLING })).toBe(
        "none",
      );
    });
  });

  describe("when a board is Organization", () => {
    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is a guest in every other project of its organization", () => {
      const standing = (place: DashboardPlace) =>
        dashboardStanding({ board: board("ORGANIZATION"), viewer: TEAMMATE, place });

      expect({
        home: standing(HOME),
        sibling: standing(SIBLING),
        stranger: standing(STRANGER),
      }).toEqual({
        home: "home",
        sibling: "guest",
        stranger: "none",
      });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is listed apart from the project's own boards, for a member and a project credential", () => {
      const own = board("PROJECT", { projectId: SIBLING.projectId });
      const shared = board("ORGANIZATION");
      const listed = (viewer: { userId: string } | undefined) =>
        dashboardsListedFor({ boards: [own, shared], viewer, place: SIBLING });

      expect([listed(TEAMMATE), listed(void 0)]).toEqual([
        { home: [own], guests: [shared] },
        { home: [own], guests: [shared] },
      ]);
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("is not a guest where the organization of the place is unknown or the board has none", () => {
      expect({
        unknownPlace: dashboardStanding({
          board: board("ORGANIZATION"),
          viewer: TEAMMATE,
          place: { projectId: SIBLING.projectId, organizationId: void 0 },
        }),
        unstamped: dashboardStanding({
          board: board("ORGANIZATION", { organizationId: null }),
          viewer: TEAMMATE,
          place: SIBLING,
        }),
      }).toEqual({ unknownPlace: "none", unstamped: "none" });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("stops being a guest once it is lowered, though it keeps its organization", () => {
      const lowered = board("PROJECT", { organizationId: HOME.organizationId! });

      expect(dashboardStanding({ board: lowered, viewer: TEAMMATE, place: SIBLING })).toBe("none");
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("locks its scope to everyone outside the project that owns it, its author included", () => {
      const lock = (place: DashboardPlace) =>
        dashboardScopeLock({ board: board("ORGANIZATION"), viewer: AUTHOR, place, mayEdit: true });

      expect({ home: lock(HOME), sibling: lock(SIBLING) }).toEqual({
        home: "none",
        sibling: "guest",
      });
    });
  });

  describe("when someone changes a board's scope", () => {
    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("is open to the author and locked to every other member", () => {
      const lock = (viewer: { userId: string } | undefined) =>
        dashboardScopeLock({ board: board("PROJECT"), viewer, place: HOME, mayEdit: true });

      expect({ author: lock(AUTHOR), teammate: lock(TEAMMATE), credential: lock(void 0) }).toEqual({
        author: "none",
        teammate: "not-author",
        credential: "not-author",
      });
    });

    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("is locked to everyone on a board with no recorded author", () => {
      const orphan = board("PROJECT", { createdById: null });

      expect(
        dashboardScopeLock({ board: orphan, viewer: AUTHOR, place: HOME, mayEdit: true }),
      ).toBe("not-author");
    });

    /** @scenario "AC174 Scope: only the author changes a board's scope" */
    it("still needs the analytics edit permission of the author", () => {
      expect(
        dashboardScopeLock({
          board: board("PROJECT"),
          viewer: AUTHOR,
          place: HOME,
          mayEdit: false,
        }),
      ).toBe("no-permission");
    });

    /** @scenario "AC175 Scope: any board can be set to Only me, My dashboard like any other" */
    it("offers the author every scope from every scope", () => {
      const open = DASHBOARD_SCOPES.map((scope) =>
        dashboardScopeLock({ board: board(scope), viewer: AUTHOR, place: HOME, mayEdit: true }),
      );

      expect(open).toEqual(["none", "none", "none"]);
    });
  });

  describe("when a change of scope takes the board from someone", () => {
    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("asks first when other members starred a board going to Only me", () => {
      expect(dashboardScopeChangeAsksFirst({ from: "PROJECT", to: "PRIVATE", otherStars: 2 })).toBe(
        true,
      );
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("asks first whenever a board leaves the organization", () => {
      const asks = (to: DashboardScope) =>
        dashboardScopeChangeAsksFirst({ from: "ORGANIZATION", to, otherStars: 0 });

      expect([asks("PROJECT"), asks("PRIVATE")]).toEqual([true, true]);
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("names who loses the board", () => {
      expect({
        toOnlyMe: dashboardScopeLoss({ from: "PROJECT", to: "PRIVATE" }),
        toProject: dashboardScopeLoss({ from: "ORGANIZATION", to: "PROJECT" }),
        allTheWay: dashboardScopeLoss({ from: "ORGANIZATION", to: "PRIVATE" }),
      }).toEqual({
        toOnlyMe: { teammates: true, otherProjects: false },
        toProject: { teammates: false, otherProjects: true },
        allTheWay: { teammates: true, otherProjects: true },
      });
    });
  });

  describe("when a change of scope takes the board from nobody", () => {
    /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
    it("does not ask before a board is widened", () => {
      const asks = (from: DashboardScope, to: DashboardScope) =>
        dashboardScopeChangeAsksFirst({ from, to, otherStars: 5 });

      expect([
        asks("PRIVATE", "PROJECT"),
        asks("PRIVATE", "ORGANIZATION"),
        asks("PROJECT", "ORGANIZATION"),
      ]).toEqual([false, false, false]);
    });

    /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
    it("does not ask before a board nobody else starred goes to Only me", () => {
      expect(dashboardScopeChangeAsksFirst({ from: "PROJECT", to: "PRIVATE", otherStars: 0 })).toBe(
        false,
      );
    });
  });
});
