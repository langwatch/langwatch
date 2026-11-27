/**
 * @vitest-environment jsdom
 * A board made in the library opens at once, unsaved, and its first edit stores it at the scope
 * and product picked; the page never answers "deleted or isn't shared" from a list read before
 * the board existed. The sidebar's list stays mounted, as it does in the app.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen, waitFor } from "@testing-library/react";
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

type Query = Readonly<Record<string, string | undefined>>;

/** A host whose address follows `navigate`, so the test moves from the library to the board. */
class NavigatingHost extends StubAnalyticsHost {
  dashboardId: string | undefined;
  query: Query = {};
  /** Each query write and whether it replaced the history entry rather than adding one. */
  readonly queryWrites: { query: Query; replace: boolean }[] = [];
  onNavigate: () => void = () => void 0;

  override route() {
    const params = this.dashboardId ? { dashboardId: this.dashboardId } : {};
    return { params, query: this.query };
  }

  override setQuery(next: Query, options?: { replace?: boolean }): void {
    this.query = next;
    this.queryWrites.push({ query: next, replace: options?.replace ?? false });
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
function server({ calls }: { calls: UiProcedureCall[] }) {
  const made: { id: string; name: string; scope: string; description?: string | null }[] = [];
  const listed = () =>
    made.map(({ id, name, scope, description = null }) => ({
      id,
      projectId: IN_VIEW.id,
      name,
      description,
      createdById: "user-1",
      scope,
      organizationId: scope === "ORGANIZATION" ? "org-1" : null,
      ownerProject: null,
      isStarred: false,
      updatedAt: new Date("2026-11-01"),
    }));
  return (call: UiProcedureCall): Promise<unknown> => {
    calls.push(call);
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
      case "boards.update": {
        const board = made.find(({ id }) => id === input.dashboardId);
        if (board && "description" in input) {
          board.description = (input as { description?: string | null }).description ?? null;
        }
        return Promise.resolve({ ...listed()[0], ...input });
      }
      case "boards.createAtScope": {
        const board = { id: "board-new", name: String(input.name), scope: String(input.scope) };
        made.push(board);
        return Promise.resolve({ ...listed()[0], ...board });
      }
      case "boards.resolve": {
        const board = made.find(({ id }) => id === input.dashboardId);
        return Promise.resolve({
          description: null,
          ...board,
          createdById: "user-1",
          updatedAt: new Date("2026-11-01"),
          project: IN_VIEW,
          openProject: IN_VIEW,
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
    it("opens unsaved, stores it on the first edit at its scope, and never reads as deleted", async () => {
      const host = new NavigatingHost({
        projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
      });
      const seen = { unavailable: false };
      const watcher = new MutationObserver(() => {
        if (document.body.textContent?.includes(UNAVAILABLE)) seen.unavailable = true;
      });
      watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
      const calls: UiProcedureCall[] = [];
      renderDashboards({ element: <Pages host={host} />, host, answer: server({ calls }) });
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      const [newDashboard] = await screen.findAllByRole("button", { name: "New dashboard" });
      if (!newDashboard) throw new Error("no New dashboard button");
      await user.click(newDashboard);
      await user.click(await screen.findByRole("radio", { name: new RegExp(visibility) }));
      await user.click(screen.getByRole("button", { name: "Create" }));

      const heading = await screen.findByRole("heading", { name: "Untitled dashboard 1" });
      expect(host.navigations).toEqual(["/dashboards/new"]);
      expect(calls.filter(({ path }) => path.startsWith("boards.create"))).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Add a description" }));
      await user.type(
        screen.getByRole("textbox", { name: "Dashboard description" }),
        "Weekly costs{Enter}",
      );

      await waitFor(() => expect(host.replacements).toEqual(["/dashboards/board-new"]));
      watcher.disconnect();
      const scope = visibility === "Only me" ? "PRIVATE" : "ORGANIZATION";
      expect(
        calls.filter(({ path }) => path === "boards.createAtScope").map(({ input }) => input),
      ).toEqual([
        { projectId: IN_VIEW.id, name: "Untitled dashboard 1", scope, homeProduct: "llm-ops" },
      ]);
      expect(calls.filter(({ path }) => path === "boards.create")).toEqual([]);
      expect(heading).toBeInTheDocument();
      expect(seen.unavailable).toBe(false);
      expect(await screen.findByRole("button", { name: "Weekly costs" })).toBeInTheDocument();
    });
  });

  /** @scenario "Create from the library with a name, product and who can see it" */
  it("stores it homed in the product picked, under the name typed, once it is edited", async () => {
    const host = new NavigatingHost({
      projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
    });
    const calls: UiProcedureCall[] = [];
    renderDashboards({ element: <Pages host={host} />, host, answer: server({ calls }) });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const [newDashboard] = await screen.findAllByRole("button", { name: "New dashboard" });
    if (!newDashboard) throw new Error("no New dashboard button");
    await user.click(newDashboard);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Product" }), "gateway");
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Gateway spend");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("heading", { name: "Gateway spend" });
    await user.click(screen.getByRole("button", { name: "Add a description" }));
    await user.type(
      screen.getByRole("textbox", { name: "Dashboard description" }),
      "Per team{Enter}",
    );

    await waitFor(() => expect(host.replacements).toEqual(["/dashboards/board-new"]));
    const made = calls.filter(({ path }) => path === "boards.createAtScope");
    expect(made.map(({ input }) => input)).toEqual([
      {
        projectId: IN_VIEW.id,
        name: "Gateway spend",
        scope: "ORGANIZATION",
        homeProduct: "gateway",
      },
    ]);
    expect(await screen.findByRole("button", { name: "Per team" })).toBeInTheDocument();
  });

  describe("when the library is opened at ?new=1", () => {
    /** @scenario "The library opened to create a dashboard opens its create dialog" */
    it("opens the create dialog, drops the key in place, and the new board opens unsaved", async () => {
      const host = new NavigatingHost({
        projectPermissions: { [IN_VIEW.id]: ["analytics:create", "analytics:update"] },
      });
      host.query = { new: "1" };
      renderDashboards({ element: <Pages host={host} />, host, answer: server({ calls: [] }) });
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      await user.click(await screen.findByRole("radio", { name: /Organization/ }));
      expect(host.queryWrites).toEqual([{ query: {}, replace: true }]);
      await user.click(screen.getByRole("button", { name: "Create" }));

      const heading = await screen.findByRole("heading", { name: "Untitled dashboard 1" });
      expect(heading).toBeInTheDocument();
      expect(host.navigations).toEqual(["/dashboards/new"]);
    });
  });
});
