/**
 * @vitest-environment jsdom
 *
 * What the card menu offers, and to which kind of card.
 *
 * Two claims a member would be hurt by getting wrong. The datapoint picker must
 * not appear on a builder graph — there is no granularity contract behind it,
 * so every step would be a control that does nothing. And a saved LangWatchQL
 * chart must offer no Edit item at all — the workbench page it used to open
 * was removed, so a menu item that still pointed at it would send a member to
 * a route that no longer exists, which is worse than not offering it.
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

// The menu's "Add to dashboard" item reads tRPC hooks at render; none of
// these scenarios show it, so the client is stubbed rather than provided.
vi.mock("~/utils/api", () => ({
  api: {
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

import { GraphCardMenu } from "../GraphCardMenu";

const withChakra = (element: ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{element}</ChakraProvider>);

// The push spy is shared by the module mock, so a stale call from a previous
// test would otherwise satisfy a later assertion.
beforeEach(() => {
  push.mockClear();
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

    it("offers no Edit item — a saved LangWatchQL chart has no editor surface anymore", async () => {
      const user = userEvent.setup();
      mount({ isWorkbenchChart: true, onGranularityChange: vi.fn() });

      await user.click(screen.getByRole("button"));

      expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
      expect(screen.queryByText("Open in workbench")).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
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
