/**
 * @vitest-environment jsdom
 * A board of a project the member cannot read, opened at a project's address: the page it
 * answers, by whether the organization's flags open the Dashboards area.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import DashboardBoardScreen from "../ui/sections/dashboard-board.screen.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const UNAVAILABLE = "This dashboard was deleted or isn't shared with you.";

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
