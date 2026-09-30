/**
 * @vitest-environment jsdom
 *
 * The click-to-edit widget name must be reachable without a pointer: the
 * rename affordance is a real button, so a keyboard user can focus it and
 * press Enter or Space to start editing (WCAG 2.1.1).
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditableWidgetName } from "../EditableWidgetName";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the widget name is not being edited", () => {
  describe("when the member focuses the rename control and presses Enter", () => {
    it("starts editing without a pointer", async () => {
      const user = userEvent.setup();
      render(<EditableWidgetName name="My widget" onRename={vi.fn()} />, {
        wrapper: Wrapper,
      });

      const trigger = screen.getByRole("button", { name: "Rename My widget" });
      trigger.focus();
      await user.keyboard("{Enter}");

      expect(screen.getByRole("textbox")).toHaveValue("My widget");
    });
  });

  describe("when the member commits a new name from the keyboard", () => {
    it("calls onRename with the trimmed value", async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<EditableWidgetName name="Old" onRename={onRename} />, {
        wrapper: Wrapper,
      });

      screen.getByRole("button", { name: "Rename Old" }).focus();
      await user.keyboard("{Enter}");
      await user.keyboard("New name{Enter}");

      expect(onRename).toHaveBeenCalledWith("New name");
    });
  });
});
