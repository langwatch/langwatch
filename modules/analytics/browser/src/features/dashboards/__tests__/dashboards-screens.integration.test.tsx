/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import {
  type UiProcedureCall,
  UiProcedureRefusal,
} from "@langwatch/browser-host/testing-transport";
import { screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import DashboardsIndexScreen from "../ui/sections/dashboards-index.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const FLAG_ON = { release_dashboards: true };
const FLAG_OFF = { release_dashboards: false };
const NOT_FOUND = { name: "This page is not here" };

type ListedBoard = { id: string; name: string; visibility: string; createdById: string | null };

const listed = ({
  id,
  name = id,
  visibility = "only_me",
  createdById = "user-1",
}: Partial<ListedBoard> & { id: string }) => ({
  id,
  name,
  description: null,
  visibility,
  createdById,
});

/** Answers the board list, and a create that adds the new board to it; every call is kept. */
function boardsServer(boards: ReturnType<typeof listed>[]) {
  const state = { boards: [...boards], calls: [] as UiProcedureCall[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    if (call.path === "dashboards.getAll") return Promise.resolve([...state.boards]);
    if (call.path === "dashboards.create") {
      const { name, visibility } = call.input as { name: string; visibility: string };
      const created = listed({ id: "board-new", name, visibility });
      state.boards.push(created);
      return Promise.resolve(created);
    }
    return NO_PROCEDURES(call);
  };
  return { state, answer };
}

function hostOpening({
  dashboardId,
  ...options
}: StubAnalyticsHostOptions & { dashboardId?: string }) {
  return new StubAnalyticsHost({
    route: { params: dashboardId === void 0 ? {} : { dashboardId }, query: {} },
    ...options,
  });
}

describe("the Dashboards screens", () => {
  describe("given the release_dashboards flag is off for the project", () => {
    describe("when a member opens /[project]/dashboards", () => {
      /** @scenario "AC1 Flag off hides the area" */
      it("shows the not-found page and forwards nowhere", () => {
        const host = hostOpening({ flags: FLAG_OFF });
        renderDashboards({ element: <DashboardsIndexScreen />, host });

        expect(screen.getByRole("heading", NOT_FOUND)).toBeInTheDocument();
        expect(host.navigations).toEqual([]);
      });
    });
  });

  describe("given the flag has not answered yet", () => {
    it("shows neither the board nor the not-found page", () => {
      renderDashboards({
        element: <DashboardBoardScreen />,
        host: hostOpening({ dashboardId: "board-1", flags: { release_dashboards: void 0 } }),
      });

      expect(screen.queryByRole("heading")).toBeNull();
    });
  });

  describe("given the flag is on", () => {
    describe("when a member without analytics:view opens /[project]/dashboards", () => {
      /** @scenario "AC21 A member without analytics:view is refused" */
      it("shows the not-found page and forwards nowhere", () => {
        const host = hostOpening({ flags: FLAG_ON, permissions: [] });
        renderDashboards({ element: <DashboardsIndexScreen />, host });

        expect(screen.getByRole("heading", NOT_FOUND)).toBeInTheDocument();
        expect(host.navigations).toEqual([]);
      });
    });

    describe("when a dashboards procedure refuses the member", () => {
      /** @scenario "AC21 A refused member sees the same not-found page" */
      it("shows the same not-found page as when the flag is off", async () => {
        const flagOff = renderDashboards({
          element: <DashboardBoardScreen />,
          host: hostOpening({ dashboardId: "board-1", flags: FLAG_OFF }),
        });
        const flagOffPage = flagOff.container.innerHTML;
        flagOff.unmount();

        const refused = renderDashboards({
          element: <DashboardBoardScreen />,
          host: hostOpening({ dashboardId: "board-1", flags: FLAG_ON }),
          answer: (call) =>
            call.path === "dashboards.getAll"
              ? Promise.reject(new UiProcedureRefusal("FORBIDDEN", 403))
              : NO_PROCEDURES(call),
        });

        expect(await screen.findByRole("heading", NOT_FOUND)).toBeInTheDocument();
        expect(refused.container.innerHTML).toBe(flagOffPage);
      });
    });

    describe("when the member opens /[project]/dashboards and has boards of their own", () => {
      /** @scenario "AC2 Landing on the member's first own board" */
      it("opens their first own board, ahead of a board someone else shared", async () => {
        const server = boardsServer([
          listed({ id: "shared", visibility: "organisation", createdById: "user-2" }),
          listed({ id: "mine-1" }),
          listed({ id: "mine-2" }),
        ]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/mine-1"]));
        expect(server.state.calls.map(({ path }) => path)).not.toContain("dashboards.create");
      });
    });

    describe("when the member can see no board at all", () => {
      /** @scenario "AC2 A member with no board gets My dashboard" */
      it("makes one My dashboard, visible only to them, and opens it", async () => {
        const server = boardsServer([]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({
          // Strict mode runs the effect twice: still only one board is made.
          element: (
            <StrictMode>
              <DashboardsIndexScreen />
            </StrictMode>
          ),
          host,
          answer: server.answer,
        });

        await waitFor(() =>
          expect(host.navigations).toEqual(["/test-project/dashboards/board-new"]),
        );
        const creates = server.state.calls.filter(({ path }) => path === "dashboards.create");
        expect(creates.map(({ input }) => input)).toEqual([
          { projectId: "proj-1", name: "My dashboard", visibility: "only_me" },
        ]);
      });
    });

    describe("when the member sees only boards others shared", () => {
      /** @scenario "AC2 Landing on the member's first own board" */
      it("opens the first of them and makes nothing", async () => {
        const server = boardsServer([
          listed({ id: "team-board", visibility: "team", createdById: "user-2" }),
        ]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });

        await waitFor(() =>
          expect(host.navigations).toEqual(["/test-project/dashboards/team-board"]),
        );
        expect(server.state.calls.map(({ path }) => path)).not.toContain("dashboards.create");
      });
    });

    describe("when the member opens one of their own boards", () => {
      it("titles the page with the board's name", async () => {
        renderDashboards({
          element: <DashboardBoardScreen />,
          host: hostOpening({ dashboardId: "board-1", flags: FLAG_ON }),
          answer: (call) => {
            if (call.path === "dashboards.getAll") {
              return Promise.resolve([listed({ id: "board-1", name: "Weekly review" })]);
            }
            if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
            return NO_PROCEDURES(call);
          },
        });

        expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
        expect(screen.queryByText("Default")).toBeNull();
      });
    });
  });
});
