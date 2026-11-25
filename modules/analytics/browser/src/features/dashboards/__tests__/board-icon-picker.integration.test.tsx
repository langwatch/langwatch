/**
 * @vitest-environment jsdom
 * The icon beside a board's title: a searchable grid that stores the pick through
 * `boards.update`, "Remove icon", the read-only view, and the grid's keyboard.
 * @see modules/dashboard/specs/dashboard-icons.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { DASHBOARD_ICONS } from "@langwatch/dashboard-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_MEMBER_PERMISSIONS, StubAnalyticsHost } from "../../../testing.tsx";
import { BOARD_ICON_GLYPHS } from "../ui/elements/board-icon-glyph.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

// jsdom loads no stylesheet, so the theme colours a chart frame is handed have no value to read.
vi.mock(import("@langwatch/design-system/color-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRawColorValue: () => "#123456",
}));

const board = (icon: string | null) => ({
  ...HOME_BOARD,
  id: "board-1",
  name: "Weekly review",
  description: null,
  icon,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-01-01"),
});

function openBoard({ icon, mayEdit = true }: { icon: string | null; mayEdit?: boolean }) {
  const calls: UiProcedureCall[] = [];
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    permissions: [...ANALYTICS_MEMBER_PERMISSIONS],
    projectPermissions: { "proj-1": mayEdit ? ["analytics:update"] : [] },
    route: { params: { dashboardId: "board-1" }, query: {} },
  });
  renderDashboards({
    element: <DashboardBoardScreen />,
    host,
    answer: (call) => {
      calls.push(call);
      switch (call.path) {
        case "featureFlag.isEnabledForEachOrganization":
          return Promise.resolve({ enabledByOrganizationId: { "org-1": true } });
        case "boards.getAll":
          return Promise.resolve([board(icon)]);
        case "boards.update":
          return Promise.resolve(board((call.input as { icon?: string | null }).icon ?? null));
        case "boards.listStarred":
        case "boards.listInOrganization":
          return Promise.resolve([]);
        case "dashboardWidgets.list":
          return Promise.resolve([]);
        default:
          return NO_PROCEDURES(call);
      }
    },
  });
  return { calls, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const updates = (calls: UiProcedureCall[]) =>
  calls.filter(({ path }) => path === "boards.update").map(({ input }) => input);

afterEach(cleanup);

describe("a board's icon picker", () => {
  describe("given a member who may edit a board with no icon", () => {
    /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
    it("searches the grid, picks an icon and stores it through boards.update", async () => {
      const { calls, user } = openBoard({ icon: null });

      await user.click(await screen.findByRole("button", { name: "Change icon" }));
      const grid = await screen.findByRole("group", { name: "Icons" });
      expect(within(grid).getAllByRole("button")).toHaveLength(DASHBOARD_ICONS.length);
      await user.type(screen.getByRole("textbox", { name: "Search icons" }), "money");
      expect(
        within(screen.getByRole("group", { name: "Icons" }))
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toContain("Dollar sign");
      await user.click(screen.getByRole("button", { name: "Dollar sign" }));

      await waitFor(() =>
        expect(updates(calls)).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", icon: "dollar-sign" },
        ]),
      );
    });

    /** @scenario "A board's icon is chosen from a searchable grid beside the title" */
    it("says so when no icon matches the search", async () => {
      const { user } = openBoard({ icon: null });

      await user.click(await screen.findByRole("button", { name: "Change icon" }));
      await user.type(await screen.findByRole("textbox", { name: "Search icons" }), "zzzz");

      expect(screen.getByText("No icons match")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove icon" })).toBeNull();
    });
  });

  describe("given a member who may edit a board whose icon is dollar-sign", () => {
    /** @scenario "The icon can be removed" */
    it("resets it to the default with Remove icon", async () => {
      const { calls, user } = openBoard({ icon: "dollar-sign" });

      await user.click(await screen.findByRole("button", { name: "Change icon" }));
      expect(await screen.findByRole("button", { name: "Dollar sign" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await user.click(screen.getByRole("button", { name: "Remove icon" }));

      await waitFor(() =>
        expect(updates(calls)).toEqual([
          { projectId: "proj-1", dashboardId: "board-1", icon: null },
        ]),
      );
    });
  });

  describe("given a reader who may not edit the board", () => {
    /** @scenario "A reader who may not edit a board sees its icon, not the button" */
    it("draws the icon beside the title and offers no button", async () => {
      openBoard({ icon: "dollar-sign", mayEdit: false });

      expect(await screen.findByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
      expect(await screen.findByTitle("Dollar sign")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Change icon" })).toBeNull();
    });
  });

  describe("given the picker is open", () => {
    /** @scenario "The grid is reachable by keyboard" */
    it("moves focus through the grid with the arrow keys", async () => {
      const { user } = openBoard({ icon: null });

      await user.click(await screen.findByRole("button", { name: "Change icon" }));
      const grid = await screen.findByRole("group", { name: "Icons" });
      const [first, second] = within(grid).getAllByRole("button");
      first!.focus();
      await user.keyboard("{ArrowRight}");
      expect(second).toHaveFocus();
      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(first).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(within(grid).getAllByRole("button")[8]).toHaveFocus();
    });
  });

  describe("given the contract's allow-list", () => {
    /** @scenario "The allow-list is one list of about 80 Lucide names" */
    it("has a glyph for every name and none besides", () => {
      expect(Object.keys(BOARD_ICON_GLYPHS).toSorted()).toEqual(DASHBOARD_ICONS.toSorted());
    });
  });
});
