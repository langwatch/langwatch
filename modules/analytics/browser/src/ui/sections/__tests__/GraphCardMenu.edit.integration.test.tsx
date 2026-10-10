/**
 * @vitest-environment jsdom
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 * Where a card's Edit action lands: a dashboard widget opens its edit
 * drawer in place; a saved LangWatchQL chart gets none (its route is gone).
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: vi.fn() } },
      graphs: { getAll: { invalidate: vi.fn() } },
    }),
    dashboards: {
      getOrCreateFirst: { useQuery: () => ({ data: undefined }) },
    },
    dashboardWidgets: {
      assignDashboard: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

import { GraphCardMenu } from "../graph-card-menu.tsx";

let host: StubAnalyticsHost;

const Wrapper = ({ children }: { children: ReactNode }) => (
  <AnalyticsTestHarness host={host}>{children}</AnalyticsTestHarness>
);

beforeEach(() => {
  host = new StubAnalyticsHost();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a card's Edit menu item", () => {
  describe("given a dashboard widget", () => {
    /** @scenario "Edit opens the widget editor in place" */
    it('is labelled "Edit", runs onEdit and does not navigate', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectId="project_test"
          projectSlug="proj"
          isDashboardWidget
          onEdit={onEdit}
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));
      const editItem = await screen.findByText(/^Edit$/);
      await user.click(editItem);

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(host.navigations).toEqual([]);
      expect(screen.queryByText("Open in playground")).not.toBeInTheDocument();
    });
  });

  describe("given a dashboard widget whose payload failed to parse", () => {
    /** @scenario "Edit opens the widget editor in place" */
    it("offers no Edit item when onEdit is absent — the builder can't edit it", async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectId="project_test"
          projectSlug="proj"
          isDashboardWidget
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
      expect(host.navigations).toEqual([]);
    });
  });

  describe("given a workbench chart", () => {
    it("offers no Edit item — a saved LangWatchQL chart has no editor surface anymore", async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectId="project_test"
          projectSlug="proj"
          isWorkbenchChart
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
      expect(screen.queryByText("Open in workbench")).not.toBeInTheDocument();
      expect(host.navigations).toEqual([]);
    });
  });

  describe("given a builder graph", () => {
    it('is labelled "Edit Graph" and navigates to the builder editor', async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectId="project_test"
          projectSlug="proj"
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));
      const editItem = await screen.findByText("Edit Graph");
      await user.click(editItem);

      expect(host.navigations).toEqual(["/proj/analytics/custom/graph_1"]);
    });
  });
});
