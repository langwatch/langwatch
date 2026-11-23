/**
 * @vitest-environment jsdom
 * A board opened by id at the organization level, `/dashboards/<id>`, over the real tRPC hooks
 * and a transport the test answers.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { libraryBoardPath } from "../model/organization-library.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import OrganizationBoardScreen from "../ui/sections/organization-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const SHOP = { id: "proj-shop", slug: "shop-abc123", name: "Shop" };

const resolved = ({
  id,
  scope,
  project,
  openProject = project,
}: {
  id: string;
  scope: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  project: typeof SHOP | null;
  openProject?: typeof SHOP | null;
}) => ({
  id,
  name: "Everyone's board",
  description: null,
  createdById: "someone",
  scope,
  updatedAt: new Date("2026-11-01"),
  project,
  openProject,
  starPosition: null,
  ownerName: null,
});

/** The board as the project it opens in lists it: an Organization board that project owns. */
const LISTED_IN_SHOP = {
  id: "board-org",
  projectId: SHOP.id,
  name: "Everyone's board",
  description: null,
  createdById: "someone",
  scope: "ORGANIZATION",
  organizationId: "org-1",
  ownerProject: null,
  isStarred: false,
  updatedAt: new Date("2026-11-01"),
};

function renderBoard({ answer }: { answer: unknown }) {
  const calls: UiProcedureCall[] = [];
  const host = new StubAnalyticsHost({
    route: { params: { dashboardId: "board-org" }, query: {} },
  });
  const respond = (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
    if (call.path === "boards.resolve") {
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
    if (call.path === "boards.getAll") return Promise.resolve([LISTED_IN_SHOP]);
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    return NO_PROCEDURES(call);
  };
  renderDashboards({ element: <OrganizationBoardScreen />, host, answer: respond });
  return { host, calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const UNAVAILABLE = "This dashboard was deleted or isn't shared with you.";

describe("a board opened at /dashboards/<id>", () => {
  describe("when it is a Project board of a project the member reads", () => {
    /** @scenario "A Project board's org-level address redirects to its project" */
    it("replaces the address with its project's, leaving no history entry", async () => {
      const { host } = renderBoard({
        answer: resolved({ id: "board-org", scope: "PROJECT", project: SHOP }),
      });

      await waitFor(() =>
        expect(host.replacements).toEqual([`/${SHOP.slug}/dashboards/board-org`]),
      );
    });
  });

  describe("when the board is not one the member may see", () => {
    /** @scenario "A Project board of a project I cannot read is not available at org level" */
    it("says it is not available, names nothing of it, and goes back to the library", async () => {
      const { host, user } = renderBoard({
        answer: new UiProcedureRefusal("dashboard_not_found", 404),
      });

      expect(await screen.findByRole("heading", { name: UNAVAILABLE })).toBeVisible();
      expect(screen.queryByText("Everyone's board")).not.toBeInTheDocument();
      expect(host.replacements).toEqual([]);
      await user.click(screen.getByRole("link", { name: "Back to Dashboards" }));
      expect(host.navigations).toEqual(["/dashboards"]);
    });
  });

  describe("when the read fails for any other reason", () => {
    // A refusal the query layer does not retry, so the page answers at once.
    it("shows the failure with Retry, not the not-available page", async () => {
      renderBoard({ answer: new UiProcedureRefusal("forbidden", 403) });

      expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
      expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    });
  });

  describe("when no project of the organization has Dashboards on", () => {
    it("answers the app's not-found page", async () => {
      renderBoard({ answer: new UiProcedureRefusal("dashboards_not_enabled", 403) });

      expect(await screen.findByRole("heading", { name: "This page is not here" })).toBeVisible();
    });
  });

  describe("when it is an Organization board", () => {
    it("opens it at that address, read in the project the board opens in", async () => {
      const { host, calls } = renderBoard({
        answer: resolved({
          id: "board-org",
          scope: "ORGANIZATION",
          project: null,
          openProject: SHOP,
        }),
      });

      const heading = await screen.findByRole("heading", { name: "Everyone's board" });
      expect(heading).toBeInTheDocument();
      const listReads = calls.filter((call) => call.path === "boards.getAll");
      expect(listReads.length).toBeGreaterThan(0);
      for (const read of listReads) {
        expect(read.input).toEqual(expect.objectContaining({ projectId: SHOP.id }));
      }
      expect(host.navigations).toEqual([]);
    });
  });
});

/** A project in view whose lists hold no board. */
const listsNothing = (call: UiProcedureCall): Promise<unknown> =>
  call.path === "boards.getAll" || call.path === "boards.listStarred"
    ? Promise.resolve([])
    : NO_PROCEDURES(call);

describe("a board of a project the member cannot read, opened at a project's address", () => {
  const openUnavailable = ({ libraryOpen }: { libraryOpen: boolean }) => {
    const host = new StubAnalyticsHost({
      flags: { release_dashboards: true },
      route: { params: { dashboardId: "board-ops" }, query: {} },
    });
    // The project in view lists its own boards and Organization boards: never Ops' Project one.
    const answer = (call: UiProcedureCall) =>
      call.path === "featureFlag.isEnabledForEachOrganization"
        ? Promise.resolve({ enabledByOrganizationId: { "org-1": libraryOpen } })
        : listsNothing(call);
    renderDashboards({ element: <DashboardBoardScreen />, host, answer });
    return { host, user: userEvent.setup({ pointerEventsCheck: 0 }) };
  };

  /** @scenario "A Project board of a project I cannot read is not available at org level" */
  it("keeps the address and says the area's sentence, naming nothing of the board", async () => {
    const { host } = openUnavailable({ libraryOpen: true });

    expect(await screen.findByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Dashboards" })).toBeVisible();
    expect(host.navigations).toEqual([]);
    expect(document.body.textContent).not.toContain("Ops");
  });

  it("goes back to the library while the organization's flags open the area", async () => {
    const { host, user } = openUnavailable({ libraryOpen: true });

    await user.click(await screen.findByRole("link", { name: "Back to Dashboards" }));

    expect(host.navigations).toEqual(["/dashboards"]);
  });

  it("keeps AC183's words while the organization's flags keep the area shut", async () => {
    openUnavailable({ libraryOpen: false });

    const heading = await screen.findByRole("heading", { name: "This dashboard is not available" });
    expect(heading).toBeVisible();
    expect(screen.queryByRole("link", { name: "Back to Dashboards" })).not.toBeInTheDocument();
  });
});

describe("a library row's address", () => {
  const row = (scope: "PRIVATE" | "PROJECT" | "ORGANIZATION") =>
    resolved({ id: "board-1", scope, project: SHOP });

  it("is the project's for a Project board, the organization's for any other", () => {
    expect(libraryBoardPath(row("PROJECT"))).toBe(`/${SHOP.slug}/dashboards/board-1`);
    expect(libraryBoardPath(row("ORGANIZATION"))).toBe("/dashboards/board-1");
    expect(libraryBoardPath(row("PRIVATE"))).toBe("/dashboards/board-1");
  });

  it("is nowhere when no project the member reads shows the board", () => {
    const unopenable = resolved({
      id: "board-1",
      scope: "ORGANIZATION",
      project: null,
      openProject: null,
    });

    expect(libraryBoardPath(unopenable)).toBeUndefined();
  });
});
