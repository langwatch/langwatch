/**
 * @vitest-environment jsdom
 *
 * Where a card's Edit action lands, by kind — and, for a saved LangWatchQL
 * chart, that there is no Edit action at all.
 *
 * A dashboard widget is edited in place: the builder can't read its
 * `{ code, queries }` payload, so its Edit item runs the card's `onEdit`
 * (which opens the edit drawer) and never navigates. A saved LangWatchQL
 * chart has no editor surface anymore: the Custom query workbench page that
 * used to open for it was removed, and nothing replaced it, so offering Edit
 * there would send a member to a route that no longer exists. The label and
 * the behaviour are asserted together: a right label that still navigated
 * away would read as a pass if either were checked alone.
 *
 * @see specs/analytics/custom-chart-playground-dashboard-placement.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => {
  const router = { query: {}, asPath: "/", push, replace: vi.fn() };
  return { useRouter: () => router, default: router };
});

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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
      expect(push).not.toHaveBeenCalled();
      expect(screen.queryByText("Open in playground")).not.toBeInTheDocument();
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
      expect(push).not.toHaveBeenCalled();
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

      expect(push).toHaveBeenCalledWith("/proj/analytics/custom/graph_1");
    });
  });
});
