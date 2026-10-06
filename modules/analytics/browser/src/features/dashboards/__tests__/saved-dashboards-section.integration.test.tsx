/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { UiProcedureCall } from "@langwatch/browser-host/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const board = ({
  id,
  name,
  visibility = "only_me",
  createdById = "user-1",
}: {
  id: string;
  name: string;
  visibility?: string;
  createdById?: string;
}) => ({ id, name, description: null, visibility, createdById });

const OWN_BOARDS = [
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

/** Answers the list and a create, and keeps every call so a test can read what was sent. */
function projectWithBoards(boards = OWN_BOARDS) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "dashboards.getAll") return Promise.resolve(boards);
    if (call.path === "dashboards.create") return Promise.resolve({ id: "board-3" });
    if (call.path === "dashboardWidgets.list") return Promise.resolve(STORED_WIDGETS);
    if (call.path === "dashboardWidgets.create") {
      return Promise.resolve({ id: `copy-${calls.length}` });
    }
    if (
      call.path === "dashboards.updateDetails" ||
      call.path === "dashboards.setVisibility" ||
      call.path === "dashboardWidgets.batchUpdateLayouts"
    ) {
      return Promise.resolve({ success: true });
    }
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderSection({
  activeDashboardId,
  boards,
}: { activeDashboardId?: string; boards?: typeof OWN_BOARDS } = {}) {
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
  const project = projectWithBoards(boards);
  renderDashboards({
    element: <SavedDashboardsSection activeDashboardId={activeDashboardId} />,
    host,
    answer: project.answer,
  });
  return { host, calls: project.calls };
}

/** The Mine group, which appears once the list has answered with a board of the member's. */
const mine = () => screen.findByRole("list", { name: "Mine" });

describe("the saved-dashboards list in the sidebar", () => {
  describe("given the release_dashboards flag is on for the project", () => {
    describe("when the member looks at the sidebar", () => {
      /** @scenario "AC3 Sidebar matches the reference" */
      it("offers Saved dashboards with a create button", () => {
        renderSection();

        expect(screen.getByText("Saved dashboards")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
      });

      /** @scenario "AC3 Sidebar matches the reference" */
      it("lists only the stored boards, with no built-in board and no Default tag", async () => {
        renderSection();

        await within(await mine()).findByRole("link", { name: /Latency/ });
        const links = within(await mine()).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
          "/test-project/dashboards/board-1",
          "/test-project/dashboards/board-2",
        ]);
        expect(screen.queryByText("Agent Flight Deck")).toBeNull();
        expect(screen.queryByText("Default")).toBeNull();
      });

      /** @scenario "AC3 Sidebar matches the reference" */
      it("gives each of the member's own boards a menu", async () => {
        renderSection();

        expect(
          await screen.findByRole("button", { name: "Actions for Weekly review" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Actions for Latency" })).toBeInTheDocument();
      });
    });

    describe("when boards are shared with the team or the organisation", () => {
      /** @scenario "AC3 Sidebar matches the reference" */
      it("groups them Mine, Team and Organisation", async () => {
        renderSection({
          boards: [
            board({ id: "board-1", name: "Weekly review", visibility: "organisation" }),
            board({ id: "board-2", name: "Latency", visibility: "team" }),
            board({ id: "board-3", name: "Scratch" }),
          ],
        });

        const hrefsIn = (list: string) =>
          within(screen.getByRole("list", { name: list }))
            .getAllByRole("link")
            .map((link) => link.getAttribute("href"));
        await screen.findByRole("list", { name: "Team" });
        expect(hrefsIn("Mine")).toEqual(["/test-project/dashboards/board-3"]);
        expect(hrefsIn("Team")).toEqual(["/test-project/dashboards/board-2"]);
        expect(hrefsIn("Organisation")).toEqual(["/test-project/dashboards/board-1"]);
      });
    });

    describe("when a teammate's board is shared with the member", () => {
      /** @scenario "AC26 Only the creator or an admin can change visibility or delete the board" */
      it("offers delete on the member's own board only, not on a teammate's", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection({
          boards: [
            board({ id: "board-1", name: "Weekly review" }),
            board({ id: "board-2", name: "Latency", visibility: "team", createdById: "user-2" }),
          ],
        });

        await user.click(await screen.findByRole("button", { name: "Actions for Weekly review" }));
        expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull());

        await user.click(screen.getByRole("button", { name: "Actions for Latency" }));
        expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
        expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
      });
    });

    describe("when the member opens a board's menu", () => {
      const menuItemNames = () =>
        screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());

      /** @scenario "AC107 Sidebar menu: each board offers its actions in the prototype's order" */
      it("offers Set as default, Rename, Share, Duplicate and Delete, in that order", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await screen.findByRole("menuitem", { name: "Delete" });

        expect(menuItemNames()).toEqual([
          "Set as default",
          "Rename",
          "Share",
          "Duplicate",
          "Delete",
        ]);
        expect(screen.getByRole("separator")).toBeInTheDocument();
      });

      /** @scenario "AC107b Sidebar menu: a board the member cannot manage offers only what they may use" */
      it("leaves Share and Delete off a teammate's board", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection({
          boards: [
            board({ id: "board-2", name: "Latency", visibility: "team", createdById: "user-2" }),
          ],
        });

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await screen.findByRole("menuitem", { name: "Duplicate" });

        expect(menuItemNames()).toEqual(["Set as default", "Rename", "Duplicate"]);
      });

      /** @scenario "AC108 Sidebar menu: Share changes who sees the board" */
      it("checks who sees the board now, and changes it to the one picked", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { calls } = renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Share" }));
        expect(await screen.findByRole("menuitemradio", { name: /Only me/ })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        await user.click(screen.getByRole("menuitemradio", { name: /Team/ }));

        await waitFor(() =>
          expect(calls.find(({ path }) => path === "dashboards.setVisibility")?.input).toEqual({
            projectId: "proj-1",
            dashboardId: "board-2",
            visibility: "team",
          }),
        );
      });

      /** @scenario "AC109 Sidebar menu: Duplicate copies the board and its widgets" */
      it("copies the board and its widgets as an only-me copy, then opens it", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        const { host, calls } = renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-3"]));
        const inputsTo = (path: string) =>
          calls.filter((call) => call.path === path).map(({ input }) => input);
        expect(inputsTo("dashboards.create")).toEqual([
          { projectId: "proj-1", name: "Latency copy", visibility: "only_me" },
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

      /** @scenario "AC109b Sidebar menu: Set as default picks the board the area opens on" */
      it("marks the board as the member's default and checks the item", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Actions for Latency" }));
        await user.click(await screen.findByRole("menuitem", { name: "Set as default" }));

        expect(
          await within(await mine()).findByRole("link", { name: /Latency.*default/ }),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Actions for Latency" }));
        expect(await screen.findByRole("menuitem", { name: /Set as default/ })).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });
    });

    describe("when the member looks for templates", () => {
      /** @scenario "AC100 Templates library: the sidebar opens the library" */
      it("offers Templates last, opening the library", async () => {
        const { host } = renderSection();
        await within(await mine()).findByRole("link", { name: /Latency/ });

        const links = screen.getAllByRole("link");
        const templates = links.at(-1);
        expect(templates).toHaveTextContent("Templates");
        expect(templates).toHaveAttribute("href", "/test-project/dashboards/templates");
        expect(templates).not.toHaveAttribute("aria-current");

        fireEvent.click(templates!);
        expect(host.navigations).toEqual(["/test-project/dashboards/templates"]);
      });

      /** @scenario "AC100 Templates library: the sidebar opens the library" */
      it("marks Templates as the current page while the library is open", () => {
        renderSection({ activeDashboardId: "templates" });

        expect(screen.getByRole("link", { name: /Templates/ })).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
    });

    describe("when the member presses the create button", () => {
      it("creates an untitled board and opens it", async () => {
        const { host, calls } = renderSection();
        await within(await mine()).findByRole("link", { name: /Latency/ });

        fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-3"]));
        expect(calls.find((call) => call.path === "dashboards.create")?.input).toEqual({
          projectId: "proj-1",
          name: "Untitled dashboard 3",
          visibility: "only_me",
        });
      });
    });
  });
});
