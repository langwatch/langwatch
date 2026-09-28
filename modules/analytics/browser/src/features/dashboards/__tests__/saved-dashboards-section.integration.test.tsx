/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import type { UiProcedureCall } from "@langwatch/browser-host/testing-transport";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { SavedDashboardsSection } from "../ui/sections/saved-dashboards-section.tsx";
import { NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const OWN_BOARDS = [
  { id: "board-1", name: "Weekly review" },
  { id: "board-2", name: "Latency" },
];

/** Answers the list and a create, and keeps every call so a test can read what was sent. */
function projectWithBoards() {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "dashboards.getAll") return Promise.resolve(OWN_BOARDS);
    if (call.path === "dashboards.create") return Promise.resolve({ id: "board-3" });
    return NO_PROCEDURES(call);
  };
  return { calls, answer };
}

function renderSection({ activeDashboardId }: { activeDashboardId?: string } = {}) {
  const host = new StubAnalyticsHost({ flags: { release_dashboards: true } });
  const project = projectWithBoards();
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

    describe("when the member presses the create button", () => {
      it("creates an untitled board and opens it", async () => {
        const { host, calls } = renderSection();
        await within(mine()).findByRole("link", { name: /Latency/ });

        fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

        await waitFor(() => expect(host.navigations).toEqual(["/test-project/dashboards/board-3"]));
        expect(calls.find((call) => call.path === "dashboards.create")?.input).toEqual({
          projectId: "proj-1",
          name: "Untitled dashboard 3",
        });
      });
    });
  });
});
