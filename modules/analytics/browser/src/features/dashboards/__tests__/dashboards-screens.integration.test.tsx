/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { UiProcedureRefusal } from "@langwatch/browser-host/testing-transport";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import { FLIGHT_DECK } from "../model/boards.ts";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import DashboardsIndexScreen from "../ui/sections/dashboards-index.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

/**
 * The Flight Deck now fires `analytics.lwql.query` mutations for its panels;
 * this suite is about routing and gating, so it answers them with empty
 * rows rather than mocking the query layer (@see flight-deck-panels test).
 */
const ANSWER_EMPTY_LWQL = (call: { path: string }) =>
  call.path === "analytics.lwql.query"
    ? Promise.resolve({ columns: [], rows: [], diagnostics: [] })
    : NO_PROCEDURES(call);

const FLAG_ON = { release_dashboards: true };
const FLAG_OFF = { release_dashboards: false };
const NOT_FOUND = { name: "This page is not here" };

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
        host: hostOpening({ dashboardId: FLIGHT_DECK.id, flags: { release_dashboards: void 0 } }),
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

    describe("when the member opens /[project]/dashboards with no default of their own", () => {
      it("forwards to the Agent Flight Deck", async () => {
        const host = hostOpening({ flags: FLAG_ON });
        renderDashboards({ element: <DashboardsIndexScreen />, host });

        await waitFor(() =>
          expect(host.navigations).toEqual(["/test-project/dashboards/agent-flight-deck"]),
        );
      });
    });

    describe("when the member opens the Agent Flight Deck", () => {
      it("titles the page, marks it Default and renders the Flight Deck panels", async () => {
        renderDashboards({
          element: <DashboardBoardScreen />,
          host: hostOpening({ dashboardId: FLIGHT_DECK.id, flags: FLAG_ON }),
          answer: ANSWER_EMPTY_LWQL,
        });

        expect(screen.getByRole("heading", { name: "Agent Flight Deck" })).toBeInTheDocument();
        expect(screen.getByText("Default")).toBeInTheDocument();
        const panels = screen.getByRole("region", { name: "Panels" });
        await waitFor(() => expect(panels).not.toBeEmptyDOMElement());
      });
    });

    describe("when the member opens one of their own boards", () => {
      it("titles the page with the board's name", async () => {
        renderDashboards({
          element: <DashboardBoardScreen />,
          host: hostOpening({ dashboardId: "board-1", flags: FLAG_ON }),
          answer: (call) =>
            call.path === "dashboards.getAll"
              ? Promise.resolve([{ id: "board-1", name: "Weekly review" }])
              : NO_PROCEDURES(call),
        });

        expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
        expect(screen.queryByText("Default")).toBeNull();
      });
    });
  });
});
