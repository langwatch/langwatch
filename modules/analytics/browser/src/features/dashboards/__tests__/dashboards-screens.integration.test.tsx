/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  description = null,
  isStarred = false,
  updatedAt = new Date("2026-01-01"),
}: {
  id: string;
  name?: string;
  description?: string | null;
  isStarred?: boolean;
  updatedAt?: Date;
}) => ({ id, name, description, createdById: "user-1", isStarred, updatedAt });

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

    describe("when the member opens /[project]/dashboards", () => {
      /** @scenario "AC2 Opening the dashboards area shows the All dashboards page" */
      it("shows the page and neither forwards nor makes a board", async () => {
        const server = boardsServer([listed({ id: "mine-1", name: "Weekly review" })]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });

        expect(await screen.findByRole("link", { name: "Weekly review" })).toBeInTheDocument();
        expect(host.navigations).toEqual([]);
        expect(server.state.calls.map(({ path }) => path)).not.toContain("dashboards.create");
      });

      /** @scenario "AC150 The dashboards nav opens the All dashboards page with two tabs" */
      it("offers a Dashboards tab, active, and a Templates tab that opens the library", async () => {
        const server = boardsServer([listed({ id: "mine-1" })]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });

        const tabs = within(screen.getByRole("navigation", { name: "Dashboards and templates" }));
        expect(tabs.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
          "aria-current",
          "page",
        );
        expect(tabs.getByRole("link", { name: "Templates" })).not.toHaveAttribute("aria-current");

        fireEvent.click(tabs.getByRole("link", { name: "Templates" }));
        expect(host.navigations).toEqual(["/test-project/dashboards/templates"]);
      });

      /** @scenario "AC151 The Dashboards tab lists every board with a star, name, menu and link" */
      it("lists every board with a star, its name as a link, its description and a menu", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = boardsServer([
          listed({
            id: "board-1",
            name: "Weekly review",
            description: "Every Monday",
            isStarred: true,
          }),
          listed({ id: "board-2", name: "Latency" }),
        ]);
        renderDashboards({
          element: <DashboardsIndexScreen />,
          host: hostOpening({ flags: FLAG_ON }),
          answer: server.answer,
        });

        const link = await screen.findByRole("link", { name: "Weekly review" });
        expect(link).toHaveAttribute("href", "/test-project/dashboards/board-1");
        expect(screen.getByText("Every Monday")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Unstar dashboard" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Star dashboard" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Latency" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Actions for Latency" }));
        const items = (await screen.findAllByRole("menuitem")).map((item) =>
          item.textContent?.trim(),
        );
        expect(items).toEqual(["Rename", "Duplicate", "Delete"]);
      });

      /** @scenario "AC151b Search narrows the list and sort orders it" */
      it("narrows the rows by the search and offers a sort", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = boardsServer([
          listed({ id: "board-1", name: "Weekly review" }),
          listed({ id: "board-2", name: "Latency" }),
        ]);
        renderDashboards({
          element: <DashboardsIndexScreen />,
          host: hostOpening({ flags: FLAG_ON }),
          answer: server.answer,
        });
        await screen.findByRole("link", { name: "Latency" });

        await user.type(screen.getByRole("textbox", { name: "Search dashboards" }), "lat");

        expect(screen.queryByRole("link", { name: "Weekly review" })).toBeNull();
        expect(screen.getByRole("link", { name: "Latency" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^Sort:/ })).toBeInTheDocument();
      });

      /** @scenario "AC153 A member stars and unstars a board from a row and from the board header" */
      it("stars a board from its row", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = boardsServer([listed({ id: "board-1", name: "Weekly review" })]);
        renderDashboards({
          element: <DashboardsIndexScreen />,
          host: hostOpening({ flags: FLAG_ON }),
          answer: server.answer,
        });

        await user.click(await screen.findByRole("button", { name: "Star dashboard" }));

        await waitFor(() =>
          expect(server.state.calls.find(({ path }) => path === "dashboards.star")?.input).toEqual({
            projectId: "proj-1",
            dashboardId: "board-1",
          }),
        );
        expect(
          server.state.calls.find(({ path }) => path === "dashboards.setVisibility"),
        ).toBeUndefined();
      });

      /** @scenario "AC151 The Dashboards tab lists every board with a star, name, menu and link" */
      it("makes an untitled board from New dashboard, sending no visibility, and opens it", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = boardsServer([listed({ id: "board-1" })]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host, answer: server.answer });
        await screen.findByRole("link", { name: "board-1" });

        await user.click(screen.getByRole("button", { name: "New dashboard" }));

        await waitFor(() =>
          expect(host.navigations).toEqual(["/test-project/dashboards/board-new"]),
        );
        expect(server.state.calls.find(({ path }) => path === "dashboards.create")?.input).toEqual({
          projectId: "proj-1",
          name: "Untitled dashboard 2",
        });
      });
    });

    describe("when the project has no board", () => {
      /** @scenario "AC152 The Dashboards tab empty state offers a template or a blank board" */
      it("says there are none and offers a template or a blank board, making nothing itself", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const server = boardsServer([]);
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({
          // Strict mode runs effects twice: opening the page still makes no board.
          element: (
            <StrictMode>
              <DashboardsIndexScreen />
            </StrictMode>
          ),
          host,
          answer: server.answer,
        });

        expect(await screen.findByText("No dashboards yet")).toBeInTheDocument();
        expect(server.state.calls.map(({ path }) => path)).not.toContain("dashboards.create");

        await user.click(screen.getByRole("button", { name: "Start from a template" }));
        expect(host.navigations).toEqual(["/test-project/dashboards/templates"]);

        await user.click(screen.getByRole("button", { name: "New blank dashboard" }));
        await waitFor(() =>
          expect(host.navigations).toContain("/test-project/dashboards/board-new"),
        );
        expect(server.state.calls.find(({ path }) => path === "dashboards.create")?.input).toEqual({
          projectId: "proj-1",
          name: "Untitled dashboard 1",
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
