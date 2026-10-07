/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const board = ({ id, name }: { id: string; name: string }) => ({
  id,
  name,
  description: null,
  createdById: "user-1",
  isStarred: true,
  updatedAt: new Date("2026-01-01"),
});

const STARS = [
  board({ id: "board-1", name: "Weekly review" }),
  board({ id: "board-2", name: "Latency" }),
];

const graph = { version: 1, code: "export default () => null;", queries: [] };

/** Two widgets on "Latency" and one on another board, as `dashboardWidgets.list` answers. */
const STORED_WIDGETS = [
  {
    id: "w-1",
    name: "Traffic",
    dashboardId: "board-2",
    gridColumn: 0,
    gridRow: 0,
    colSpan: 6,
    rowSpan: 3,
    graph,
  },
  {
    id: "w-2",
    name: "Cost",
    dashboardId: "board-2",
    gridColumn: 6,
    gridRow: 0,
    colSpan: 6,
    rowSpan: 3,
    graph,
  },
  {
    id: "w-3",
    name: "Other",
    dashboardId: "board-1",
    gridColumn: 0,
    gridRow: 0,
    colSpan: 12,
    rowSpan: 3,
    graph,
  },
];

/** Answers the star list, the board list and the writes, keeping every call for the test. */
function projectWithStars({
  stars = STARS,
  listStarredFails = false,
}: { stars?: typeof STARS; listStarredFails?: boolean } = {}) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "dashboards.listStarred") {
      return listStarredFails ? Promise.reject(new Error("down")) : Promise.resolve(stars);
    }
    if (call.path === "dashboards.getAll") return Promise.resolve(stars);
    if (call.path === "dashboards.create")
      return Promise.resolve({ id: "board-3", name: "Latency copy" });
    if (call.path === "dashboardWidgets.list") return Promise.resolve(STORED_WIDGETS);
    if (call.path === "dashboardWidgets.create") {
      return Promise.resolve({ id: `copy-${calls.length}` });
    }
    const ACK_PATHS = [
      "dashboards.updateDetails",
      "dashboards.unstar",
      "dashboards.reorderStars",
      "dashboards.delete",
      "dashboardWidgets.batchUpdateLayouts",
    ];
    if (ACK_PATHS.includes(call.path)) {
      return Promise.resolve({ success: true });
    }
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderSection({
  activeDashboardId,
  ...options
}: { activeDashboardId?: string; stars?: typeof STARS; listStarredFails?: boolean } = {}) {
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
  const project = projectWithStars(options);
  renderDashboards({
    element: <SavedDashboardsSection activeDashboardId={activeDashboardId} />,
    host,
    answer: project.answer,
  });
  return { host, calls: project.calls };
}

const starredList = () => screen.findByRole("list", { name: "Starred dashboards" });

describe("the starred-dashboards list in the sidebar", () => {
  describe("given the release_dashboards flag is on for the project", () => {
    describe("when the member looks at the sidebar", () => {
      /** @scenario "AC3 Sidebar matches the reference" */
      it("lists the member's stars with no built-in board and no Default tag", async () => {
        renderSection();

        const links = within(await starredList()).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
          "/test-project/dashboards/board-1",
          "/test-project/dashboards/board-2",
        ]);
        expect(screen.getByText("Starred")).toBeInTheDocument();
        expect(screen.queryByText("Agent Flight Deck")).toBeNull();
        expect(screen.queryByText("Default")).toBeNull();
        expect(screen.queryByRole("button", { name: "New dashboard" })).toBeNull();
      });

      /** @scenario "AC3 Sidebar matches the reference" */
      it("gives each starred board a menu", async () => {
        renderSection();

        expect(
          await screen.findByRole("button", { name: "Actions for Weekly review" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Actions for Latency" })).toBeInTheDocument();
      });
    });

    describe("when the member has starred boards", () => {
      /** @scenario "AC154 The sidebar shows my stars for this project, then All dashboards" */
      it("lists the stars in the member's order, then an All dashboards link", async () => {
        const { host } = renderSection();
        await starredList();

        const links = screen.getAllByRole("link");
        const all = links.at(-1);
        expect(all).toHaveTextContent("All dashboards");
        expect(all).toHaveAttribute("href", "/test-project/dashboards");
        expect(all).toHaveAttribute("aria-current", "page");

        fireEvent.click(all!);
        expect(host.navigations).toEqual(["/test-project/dashboards"]);
      });

      /** @scenario "AC154 The sidebar shows my stars for this project, then All dashboards" */
      it("shows a one-line error with Retry when the stars fail to load", async () => {
        renderSection({ listStarredFails: true });

        expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /All dashboards/ })).toBeInTheDocument();
      });

      /** @scenario "AC154 The sidebar shows my stars for this project, then All dashboards" */
      it("unstars a board from its star icon", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { calls, host } = renderSection();
        await starredList();

        await user.click(screen.getAllByRole("button", { name: "Unstar dashboard" })[1]!);

        await waitFor(() =>
          expect(calls.find(({ path }) => path === "dashboards.unstar")?.input).toEqual({
            projectId: "proj-1",
            dashboardId: "board-2",
          }),
        );
        expect(host.navigations).toEqual([]);
      });
    });

    describe("when the member opens a starred board's menu", () => {
      const menuItemNames = () =>
        screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());

      /** @scenario "AC107 Sidebar menu: each starred board offers its actions in order" */
      it("offers Rename, Duplicate, Move up, Move down and Delete, with no Share or default", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await screen.findByRole("menuitem", { name: "Delete" });

        expect(menuItemNames()).toEqual(["Rename", "Duplicate", "Move up", "Move down", "Delete"]);
        expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
        expect(screen.queryByRole("menuitem", { name: "Set as default" })).toBeNull();
        expect(screen.getByRole("separator")).toBeInTheDocument();
      });

      /** @scenario "AC107b Sidebar menu: reorder is bounded by the list's ends" */
      it("disables Move up on the first star and Move down on the last", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
        expect(await screen.findByRole("menuitem", { name: "Move up" })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(screen.getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute(
          "aria-disabled",
          "true",
        );
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull());

        await user.click(screen.getByRole("button", { name: "Actions for Latency" }));
        expect(await screen.findByRole("menuitem", { name: "Move down" })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });

      /** @scenario "AC155 Move up and Move down reorder the member's stars" */
      it("swaps a board with the one above and saves the new order", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { calls } = renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Move up" }));

        await waitFor(() =>
          expect(calls.find(({ path }) => path === "dashboards.reorderStars")?.input).toEqual({
            projectId: "proj-1",
            dashboardIds: ["board-2", "board-1"],
          }),
        );
      });

      /** @scenario "AC109 Sidebar menu: Duplicate copies the board and its widgets" */
      it("copies the board and its widgets, then opens it, sending no visibility", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, calls } = renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-3"]));
        const inputsTo = (path: string) =>
          calls.filter((call) => call.path === path).map(({ input }) => input);
        expect(inputsTo("dashboards.create")).toEqual([
          { projectId: "proj-1", name: "Latency copy" },
        ]);
        expect(
          inputsTo("dashboardWidgets.create").map((input) => (input as { name: string }).name),
        ).toEqual(["Traffic", "Cost"]);
        const [{ layouts }] = inputsTo("dashboardWidgets.batchUpdateLayouts") as [
          { layouts: { gridColumn: number; gridRow: number }[] },
        ];
        expect(layouts.map(({ gridColumn, gridRow }) => [gridColumn, gridRow])).toEqual([
          [0, 0],
          [6, 0],
        ]);
      });

      /** @scenario "AC107 Sidebar menu: each starred board offers its actions in order" */
      it("deletes a board after the member confirms", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { calls } = renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
        const dialog = await screen.findByRole("dialog");
        expect(calls.some(({ path }) => path === "dashboards.delete")).toBe(false);
        await user.click(within(dialog).getByRole("button", { name: "Delete" }));

        await waitFor(() =>
          expect(calls.find(({ path }) => path === "dashboards.delete")?.input).toEqual({
            projectId: "proj-1",
            dashboardId: "board-2",
          }),
        );
      });
    });
  });
});
