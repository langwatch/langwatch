/**
 * @vitest-environment jsdom
 * The "Board › Widget" trail analytics lends an insight row: links while the board and the
 * widget exist, the kept names once they are gone.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost, type StubAnalyticsHostOptions } from "../../../testing.tsx";
import { DashboardPointer } from "../ui/sections/dashboard-pointer.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const BOARD = {
  id: "board-1",
  name: "Checkout health",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
};
const WIDGET = {
  id: "widget-1",
  dashboardId: "board-1",
  name: "Errors by day",
  gridColumn: 0,
  gridRow: 0,
  colSpan: 2,
  rowSpan: 2,
  graph: { version: 1, code: "export default () => null;", queries: [] },
};
const DASHBOARDS_ON = { flags: { release_dashboards: true } };

function renderPointer({
  boards,
  widgets,
  host: options = DASHBOARDS_ON,
}: {
  boards: unknown[];
  widgets: unknown[];
  host?: StubAnalyticsHostOptions;
}) {
  const host = new StubAnalyticsHost(options);
  const asked: string[] = [];
  const answer = (call: UiProcedureCall) => {
    asked.push(call.path);
    if (call.path === "dashboards.getAll") return Promise.resolve(boards);
    if (call.path === "dashboardWidgets.list") return Promise.resolve(widgets);
    return NO_PROCEDURES(call);
  };
  renderDashboards({
    element: (
      <p data-testid="trail">
        <DashboardPointer
          boardId="board-1"
          boardName="Checkout health"
          widget={{ id: "widget-1", name: "Errors by day" }}
        />
      </p>
    ),
    host,
    answer,
  });
  return { host, asked };
}

afterEach(cleanup);

describe("given an insight that came from a widget on a board", () => {
  describe("when the board and the widget still exist", () => {
    /** @scenario "The row links to the board and the widget while they exist" */
    it("links the board's name and the widget's name to the board", async () => {
      const { host } = renderPointer({ boards: [BOARD], widgets: [WIDGET] });

      const board = await screen.findByRole("link", { name: "Checkout health" });
      const widget = await screen.findByRole("link", { name: "Errors by day" });
      expect(board).toHaveAttribute("href", "/test-project/dashboards/board-1");
      expect(widget).toHaveAttribute("href", "/test-project/dashboards/board-1");

      await userEvent.click(board);
      expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]);
    });
  });

  describe("when the board was deleted", () => {
    /** @scenario "A deleted board leaves plain names on the row" */
    it("reads the board as deleted and offers no link for either name", async () => {
      renderPointer({ boards: [], widgets: [] });

      expect(await screen.findByText("Checkout health (deleted)")).toBeInTheDocument();
      expect(screen.getByText("Errors by day")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("when the widget was removed from the board", () => {
    /** @scenario "A deleted widget leaves its name on the row" */
    it("still links the board and reads the widget as deleted", async () => {
      renderPointer({ boards: [BOARD], widgets: [] });

      expect(await screen.findByRole("link", { name: "Checkout health" })).toBeInTheDocument();
      expect(await screen.findByText("Errors by day (deleted)")).toBeInTheDocument();
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });
  });

  describe("when Dashboards is not open to the reader", () => {
    /** @scenario "A reader without Dashboards reads the names without links" */
    it("shows the names as they were filed, asks for no board, and calls nothing deleted", async () => {
      const { asked } = renderPointer({ boards: [], widgets: [], host: {} });

      expect(screen.getByTestId("trail")).toHaveTextContent("Checkout health›Errors by day");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      await waitFor(() => expect(asked).toEqual([]));
    });
  });
});
