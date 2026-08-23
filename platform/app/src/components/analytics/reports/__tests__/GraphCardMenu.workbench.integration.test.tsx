/**
 * @vitest-environment jsdom
 *
 * What the card menu offers, and to which kind of card.
 *
 * Two claims a member would be hurt by getting wrong. The datapoint picker must
 * not appear on a builder graph — there is no granularity contract behind it,
 * so every step would be a control that does nothing. And Edit must lead to the
 * surface that can actually open the chart: sending a saved statement to the
 * builder's editor lands a member on a page that cannot read it.
 *
 * Drives the real Chakra menus rather than asserting on props, because "the
 * member can reach it" is the claim, and a prop that never renders satisfies a
 * prop assertion.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push, query: {} }),
}));

import { GraphCardMenu } from "../GraphCardMenu";

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

// The push spy is shared by the module mock, so a stale call from a previous
// test would otherwise satisfy a later assertion.
beforeEach(() => {
  push.mockClear();
});

function mount(overrides: Partial<Parameters<typeof GraphCardMenu>[0]> = {}) {
  const onGranularityChange = vi.fn();
  const onSizeChange = vi.fn();
  const onDelete = vi.fn();

  withChakra(
    <GraphCardMenu
      graphId="chart-1"
      projectSlug="my-project"
      dashboardId="dashboard-1"
      colSpan={1}
      rowSpan={1}
      onSizeChange={onSizeChange}
      onDelete={onDelete}
      isDeleting={false}
      {...overrides}
    />,
  );

  return { onGranularityChange, onSizeChange, onDelete };
}

describe("the dashboard card menu", () => {
  describe("given a builder graph", () => {
    it("offers no datapoint picker", async () => {
      const user = userEvent.setup();
      mount();

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/Datapoints/)).not.toBeInTheDocument();
    });

    it("edits in the chart builder", async () => {
      const user = userEvent.setup();
      mount();

      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText("Edit Graph"));

      expect(push).toHaveBeenCalledWith(
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

    it("sends the member to the workbench, not the builder", async () => {
      const user = userEvent.setup();
      mount({ isWorkbenchChart: true, onGranularityChange: vi.fn() });

      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText("Open in workbench"));

      // No `?chart=` — the workbench has no deep-link parameter, and a URL
      // claiming to open a chart it cannot open is worse than one that does
      // not claim to.
      expect(push).toHaveBeenCalledWith("/my-project/analytics/query");
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
