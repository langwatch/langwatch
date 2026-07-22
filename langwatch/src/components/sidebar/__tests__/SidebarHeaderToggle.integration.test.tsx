/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/sidebar-collapse-preference.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarHeaderToggle } from "../SidebarHeaderToggle";

const renderToggle = (
  props: Partial<React.ComponentProps<typeof SidebarHeaderToggle>> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SidebarHeaderToggle
        isCollapsed={false}
        canToggle={true}
        onToggle={() => {}}
        {...props}
      />
    </ChakraProvider>,
  );

describe("SidebarHeaderToggle", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the sidebar is expanded", () => {
    /** @scenario Collapsing the sidebar from any page */
    it("collapses via the control next to the logo", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderToggle({ onToggle });

      await user.click(
        screen.getByRole("button", { name: "Collapse sidebar" }),
      );

      expect(onToggle).toHaveBeenCalledWith(true);
    });
  });

  describe("when the sidebar is collapsed", () => {
    /** @scenario Expanding a collapsed sidebar via the logo */
    it("expands via the control that replaces the logo", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      renderToggle({ isCollapsed: true, onToggle });

      await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  describe("when the screen is too small to toggle", () => {
    /** @scenario Small screens stay compact */
    it("renders the logo without any toggle control", () => {
      renderToggle({ isCollapsed: true, canToggle: false });

      expect(
        screen.queryByRole("button", { name: /sidebar/i }),
      ).not.toBeInTheDocument();
    });
  });
});
