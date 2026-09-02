/**
 * @vitest-environment jsdom
 *
 * Where a card's Edit action lands, by kind.
 *
 * Each kind is edited on the surface that wrote it — the builder can't read a
 * saved statement, and neither the builder nor the workbench can read a
 * playground widget's `{ code, queries }`. Getting this wrong sends a member
 * to an empty editor with a URL claiming otherwise, which is why the label
 * and the destination are asserted together: a right label pointed at the
 * wrong route would still read as a pass if either were checked alone.
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

import { GraphCardMenu } from "../GraphCardMenu";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a card's Edit menu item", () => {
  describe("given a playground widget", () => {
    /** @scenario "A playground card's Edit action opens the playground page" */
    it("is labelled \"Open in playground\" and navigates to the playground page", async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectSlug="proj"
          colSpan={1}
          rowSpan={1}
          isPlaygroundWidget
          onSizeChange={vi.fn()}
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));
      const editItem = await screen.findByText("Open in playground");
      await user.click(editItem);

      expect(push).toHaveBeenCalledWith("/proj/dev/custom-chart-playground");
    });
  });

  describe("given a workbench chart", () => {
    it("is labelled \"Open in workbench\" and navigates to the workbench, not the playground", async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectSlug="proj"
          colSpan={1}
          rowSpan={1}
          isWorkbenchChart
          onSizeChange={vi.fn()}
          onDelete={vi.fn()}
          isDeleting={false}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button"));
      const editItem = await screen.findByText("Open in workbench");
      await user.click(editItem);

      expect(push).toHaveBeenCalledWith("/proj/analytics/query");
    });
  });

  describe("given a builder graph", () => {
    it("is labelled \"Edit Graph\" and navigates to the builder editor", async () => {
      const user = userEvent.setup();
      render(
        <GraphCardMenu
          graphId="graph_1"
          projectSlug="proj"
          colSpan={1}
          rowSpan={1}
          onSizeChange={vi.fn()}
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
