/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
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

/** Answers the list and a create, and keeps every call so a test can read what was sent. */
function projectWithBoards(boards = OWN_BOARDS) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "dashboards.getAll") return Promise.resolve(boards);
    if (call.path === "dashboards.create") return Promise.resolve({ id: "board-3" });
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

const mine = () => screen.getByRole("list", { name: "Mine" });

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
      it("lists the Agent Flight Deck first, tagged Default, then the member's own boards", async () => {
        renderSection();

        await within(mine()).findByRole("link", { name: /Latency/ });
        const links = within(mine()).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
          "/test-project/dashboards/agent-flight-deck",
          "/test-project/dashboards/board-1",
          "/test-project/dashboards/board-2",
        ]);
        expect(links[0]).toHaveTextContent("Agent Flight Deck");
        expect(links[0]).toHaveTextContent("Default");
      });

      /** @scenario "AC3 Sidebar matches the reference" */
      it("gives each of the member's own boards a menu, and the Flight Deck none", async () => {
        renderSection();

        expect(
          await screen.findByRole("button", { name: "Actions for Weekly review" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Actions for Latency" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Actions for Agent Flight Deck" })).toBeNull();
      });
    });

    describe("when boards are shared with the team or the organisation", () => {
      /** @scenario "AC3 Sidebar matches the reference" */
      it("groups them Mine, Team and Organisation, the Flight Deck leading Mine", async () => {
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
        expect(hrefsIn("Mine")).toEqual([
          "/test-project/dashboards/agent-flight-deck",
          "/test-project/dashboards/board-3",
        ]);
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

    describe("when the member presses the create button", () => {
      it("creates an untitled board and opens it", async () => {
        const { host, calls } = renderSection();
        await within(mine()).findByRole("link", { name: /Latency/ });

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
