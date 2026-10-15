/**
 * @vitest-environment jsdom
 * What the card menu offers, per kind: no datapoint picker on a builder
 * graph, and no Edit item on a saved chart (its workbench route is gone).
 * @see specs/lwql/saved-charts.feature
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { GraphCardMenu } from "../graph-card-menu.tsx";

let host: StubAnalyticsHost;

const withChakra = (element: ReactElement) =>
  render(<AnalyticsTestHarness host={host}>{element}</AnalyticsTestHarness>);

beforeEach(() => {
  host = new StubAnalyticsHost();
});

function mount(overrides: Partial<Parameters<typeof GraphCardMenu>[0]> = {}) {
  const onDelete = vi.fn();

  withChakra(
    <GraphCardMenu
      graphId="chart-1"
      projectSlug="my-project"
      dashboardId="dashboard-1"
      onDelete={onDelete}
      isDeleting={false}
      {...overrides}
    />,
  );

  return { onDelete };
}

describe("the dashboard card menu", () => {
  describe("given a builder graph", () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(async () => {
      user = userEvent.setup();
      mount();
      await user.click(screen.getByRole("button"));
    });
    it("offers no datapoint picker", async () => {
      expect(screen.queryByText(/Datapoints/)).not.toBeInTheDocument();
    });

    it("edits in the chart builder", async () => {
      await user.click(screen.getByText("Edit graph"));

      expect(host.navigations).toContain(
        "/my-project/analytics/custom/chart-1?dashboard=dashboard-1",
      );
    });
  });

  describe("given a saved workbench chart", () => {
    it("offers the step the card is currently running at", async () => {
      const user = userEvent.setup();
      const onGranularityChange = vi.fn();
      mount({
        isWorkbenchChart: true,
        granularitySeconds: 60,
        onGranularityChange,
      });

      await user.click(screen.getByRole("button"));

      expect(screen.getByText(/Datapoints \(1 minute\)/)).toBeInTheDocument();
    });

    it("reports the step the member picks", async () => {
      const user = userEvent.setup();
      const onGranularityChange = vi.fn();
      mount({
        isWorkbenchChart: true,
        granularitySeconds: 60,
        onGranularityChange,
      });

      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText(/Datapoints/));
      await user.click(await screen.findByText("1 hour"));

      // Seconds, which is what the granularity contract is denominated in.
      expect(onGranularityChange).toHaveBeenCalledWith(3600);
    });

    it("offers no Edit item — a saved LangWatchQL chart has no editor surface anymore", async () => {
      const user = userEvent.setup();
      mount({ isWorkbenchChart: true, onGranularityChange: vi.fn() });

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
      expect(screen.queryByText("Open in workbench")).not.toBeInTheDocument();
      expect(host.navigations).toEqual([]);
    });

    it("offers no picker when the surface cannot accept a change", async () => {
      // No handler means nothing can be done with a pick; offering the control
      // anyway would be a menu item that silently does nothing.
      const user = userEvent.setup();
      mount({ isWorkbenchChart: true, granularitySeconds: 60 });

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/Datapoints/)).not.toBeInTheDocument();
    });
  });
});
