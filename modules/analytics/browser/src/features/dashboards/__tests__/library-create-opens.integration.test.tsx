/**
 * @vitest-environment jsdom
 * A board made in the library opens at once: the board page never answers "deleted or isn't
 * shared" from a list read before the board existed. The sidebar's list stays mounted, as it
 * does in the app, so the page shares a held answer that lacks the new board.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { StubAnalyticsHost } from "../../../testing.tsx";
import DashboardsLibraryScreen from "../ui/sections/dashboards-library.screen.tsx";
import OrganizationBoardScreen from "../ui/sections/organization-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const IN_VIEW = { id: "proj-1", slug: "test-project", name: "Test Project" };
const UNAVAILABLE = "This dashboard was deleted or isn't shared with you.";

/** A host whose address follows `navigate`, so the test moves from the library to the board. */
class NavigatingHost extends StubAnalyticsHost {
  dashboardId: string | undefined;
  onNavigate: () => void = () => void 0;

  override route() {
    return { params: this.dashboardId ? { dashboardId: this.dashboardId } : {}, query: {} };
  }

  override navigate(to: string, options?: { replace?: boolean }): void {
    super.navigate(to, options);
    this.dashboardId = to.split("/").at(-1);
    this.onNavigate();
  }
}

/** Stands in for the sidebar: it holds the project's list from before the create. */
function HeldList() {
  analyticsApi.boards.getAll.useQuery({ projectId: IN_VIEW.id, includeOrganization: true });
  return null;
}

function Pages({ host }: { host: NavigatingHost }) {
  const [, setAddress] = useState(0);
  useEffect(() => {
    host.onNavigate = () => setAddress((count) => count + 1);
  }, [host]);
  return (
    <>
      <HeldList />
      {host.dashboardId ? <OrganizationBoardScreen /> : <DashboardsLibraryScreen />}
    </>
  );
}

/** The server: the new board is in every read made after the create, and in none before. */
function server() {
  const made: { id: string; name: string; scope: string }[] = [];
  const listed = () =>
    made.map(({ id, name, scope }) => ({
      id,
      projectId: IN_VIEW.id,
      name,
      description: null,
      createdById: "user-1",
      scope,
      organizationId: scope === "ORGANIZATION" ? "org-1" : null,
      ownerProject: null,
      isStarred: false,
      updatedAt: new Date("2026-11-01"),
    }));
  return (call: UiProcedureCall): Promise<unknown> => {
    const input = call.input as { name?: string; scope?: string; dashboardId?: string };
    switch (call.path) {
      case "boards.storeProjects":
        return Promise.resolve([IN_VIEW]);
      case "boards.listInOrganization":
      case "boards.listStarred":
      case "dashboardWidgets.list":
        return Promise.resolve([]);
      case "boards.getAll":
        return Promise.resolve(listed());
      case "boards.createAtScope": {
        const board = { id: "board-new", name: String(input.name), scope: String(input.scope) };
        made.push(board);
        return Promise.resolve({ ...listed()[0], ...board });
      }
      case "boards.resolve": {
        const board = made.find(({ id }) => id === input.dashboardId);
        return Promise.resolve({
          ...board,
          description: null,
          createdById: "user-1",
          updatedAt: new Date("2026-11-01"),
          project: IN_VIEW,
          openProject: IN_VIEW,
          starPosition: null,
          ownerName: null,
        });
      }
      default:
        return NO_PROCEDURES(call);
    }
  };
}

describe("a board made in the library", () => {
  describe.each(["Only me", "Organization"])("when it is made %s", (visibility) => {
    /** @scenario "A board made in the library is made at its scope in one write" */
    it("opens at its address and never reads as deleted", async () => {
      const host = new NavigatingHost({
        projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
      });
      const seen = { unavailable: false };
      const watcher = new MutationObserver(() => {
        if (document.body.textContent?.includes(UNAVAILABLE)) seen.unavailable = true;
      });
      watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
      renderDashboards({ element: <Pages host={host} />, host, answer: server() });
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      await user.click((await screen.findAllByRole("button", { name: "New dashboard" }))[0]);
      await user.click(await screen.findByRole("radio", { name: new RegExp(visibility) }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      const heading = await screen.findByRole("heading", { name: "Untitled dashboard 1" });
      watcher.disconnect();
      expect(heading).toBeInTheDocument();
      expect(host.navigations).toEqual(["/dashboards/board-new"]);
      expect(seen.unavailable).toBe(false);
    });
  });
});
