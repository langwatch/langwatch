/**
 * @vitest-environment jsdom
 * The starred group analytics lends the other products' sidebars: the member's stars as links
 * into Dashboards, and nothing at all when there are none or they cannot be read.
 * @see modules/navigation/specs/product-sidebars.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { StubAnalyticsHost } from "../../../testing.tsx";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { StarredDashboardsSection } from "../ui/sections/starred-dashboards-section.tsx";
import { HOME_BOARD, NO_PROCEDURES, renderDashboards } from "./render-dashboards.test-helpers.tsx";

const LATENCY = {
  ...HOME_BOARD,
  id: "board-1",
  name: "Latency",
  order: 0,
  description: null,
  createdById: "user-1",
  isStarred: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  _count: { graphs: 0 },
};

function renderStarred({ stars, fails = false }: { stars: unknown[]; fails?: boolean }) {
  const host = new StubAnalyticsHost();
  let answered = 0;
  const answer = (call: UiProcedureCall) => {
    answered += 1;
    if (call.path !== "dashboards.listStarred") return NO_PROCEDURES(call);
    return fails ? Promise.reject(new Error("down")) : Promise.resolve(stars);
  };
  renderDashboards({ element: <StarredDashboardsSection />, host, answer });
  return { host, calls: () => answered };
}

afterEach(cleanup);

describe("the starred dashboards group", () => {
  describe("given the member starred a board and a From LangWatch board", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("lists both in the member's order, and an entry opens its dashboard", async () => {
      const user = userEvent.setup();
      const { host } = renderStarred({
        stars: [
          { kind: "board", dashboard: LATENCY },
          { kind: "template", templateId: "release" },
        ],
      });

      const group = within(await screen.findByRole("region", { name: "Starred dashboards" }));
      const release = CURATED_BOARDS.find(({ templateId }) => templateId === "release")!;
      expect(group.getAllByRole("link").map((link) => link.textContent)).toEqual([
        "Latency",
        release.name,
      ]);
      await user.click(group.getByRole("link", { name: "Latency" }));
      expect(host.navigations).toEqual(["/test-project/dashboards/board-1"]);
    });
  });

  describe("given the member starred nothing, or the stars cannot be read", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("draws nothing", async () => {
      const empty = renderStarred({ stars: [] });
      await waitFor(() => expect(empty.calls()).toBeGreaterThan(0));
      await waitFor(() => expect(screen.queryByText("Starred dashboards")).toBeNull());
      cleanup();

      const failed = renderStarred({ stars: [], fails: true });
      await waitFor(() => expect(failed.calls()).toBeGreaterThan(0));
      await waitFor(() => expect(screen.queryByText("Starred dashboards")).toBeNull());
    });
  });
});
