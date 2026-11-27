/**
 * @vitest-environment jsdom
 * A board made after the boards list was read (by Langy, the CLI or another tab) opens from its
 * link instead of reading as unavailable.
 * @see modules/dashboard/specs/board-made-elsewhere.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const UNAVAILABLE = "This dashboard was deleted or isn't shared with you.";

const weeklyUsage = {
  ...HOME_BOARD,
  id: "board-weekly",
  name: "Weekly usage",
  description: null,
  createdById: "user-1",
  isStarred: false,
  updatedAt: new Date("2026-11-25"),
};

/** Answers the board list from `lists`, one read after another (the last one repeats). */
function openWith(lists: (typeof weeklyUsage)[][]) {
  const listReads: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall): Promise<unknown> => {
    if (call.path === "boards.getAll") {
      listReads.push(call);
      return Promise.resolve(lists[Math.min(listReads.length, lists.length) - 1]);
    }
    if (call.path === "boards.listStarred") return Promise.resolve([]);
    if (call.path === "dashboardWidgets.list") return Promise.resolve([]);
    if (call.path === "featureFlag.isEnabledForEachOrganization") {
      return Promise.resolve({ enabledByOrganizationId: { "org-1": true } });
    }
    return NO_PROCEDURES(call);
  };
  const host = new StubAnalyticsHost({
    flags: { release_dashboards: true },
    route: { params: { dashboardId: "board-weekly" }, query: {} },
  });
  renderDashboards({ element: <DashboardBoardScreen />, host, answer });
  return { listReads };
}

afterEach(cleanup);

describe("a board made after the boards list was read", () => {
  /** @scenario "Opening a board made after the list was read shows the board" */
  it("reads the list again and shows the board, not the unavailable page", async () => {
    const { listReads } = openWith([[], [weeklyUsage]]);

    expect(await screen.findByRole("heading", { name: "Weekly usage" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: UNAVAILABLE })).toBeNull();
    expect(listReads).toHaveLength(2);
  });

  /** @scenario "A board that is really gone is still unavailable after the re-read" */
  it("shows the unavailable page once the one re-read still lacks it", async () => {
    const { listReads } = openWith([[]]);

    expect(await screen.findByRole("heading", { name: UNAVAILABLE })).toBeVisible();
    expect(listReads).toHaveLength(2);
  });
});
