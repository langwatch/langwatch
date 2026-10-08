/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
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

const listed = ({
  id,
  name = id,
  createdById = "user-1",
}: {
  id: string;
  name?: string;
  createdById?: string;
}) => ({
  id,
  name,
  description: null,
  createdById,
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
});

/** Answers the board list, a create and the star writes; every call is kept. */
function boardsServer(boards: ReturnType<typeof listed>[]) {
  const state = { boards: [...boards], calls: [] as UiProcedureCall[] };
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    state.calls.push(call);
    if (call.path === "dashboards.getAll") return Promise.resolve([...state.boards]);
    if (call.path === "dashboards.create") {
      const created = listed({ id: "board-new", name: (call.input as { name: string }).name });
      state.boards.push(created);
      return Promise.resolve(created);
    }
    if (call.path === "dashboards.star" || call.path === "dashboards.unstar") {
      return Promise.resolve({ success: true });
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

    describe("when the member opens /[project]/dashboards and has a My dashboard", () => {
      /** @scenario "AC160 The dashboards area lands on My dashboard" */
      it("opens it in place of the area, making no board", async () => {
        const server = boardsServer([
          listed({ id: "team-1", name: "Weekly review" }),
          listed({ id: "theirs", name: "My dashboard", createdById: "user-2" }),
          listed({ id: "mine", name: "My dashboard" }),
        ]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/mine"]));
        expect(server.state.calls.map(({ path }) => path)).not.toContain("dashboards.create");
      });
    });

    describe("when the member has no My dashboard yet", () => {
      /** @scenario "AC160b A member with no My dashboard gets one made, starred for them" */
      it("makes exactly one and opens it, leaving the star to the server", async () => {
        const server = boardsServer([listed({ id: "team-1", name: "Weekly review" })]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({
          // Strict mode runs effects twice: opening the area still makes one board.
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
        const paths = server.state.calls.map(({ path }) => path);
        expect(paths.filter((path) => path === "dashboards.create")).toHaveLength(1);
        expect(paths).not.toContain("dashboards.star");
        expect(server.state.calls.find(({ path }) => path === "dashboards.create")?.input).toEqual({
          projectId: "proj-1",
          name: "My dashboard",
        });
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
            if (call.path === "dashboards.listStarred") return Promise.resolve([]);
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
