/**
 * @vitest-environment jsdom
 *
 * Tests for RowHeightToggle component.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowHeightToggle } from "../components/RowHeightToggle";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("RowHeightToggle", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders a trigger button", () => {
      render(<RowHeightToggle />, { wrapper: Wrapper });

      // Should have a button that triggers the popover
      const button = document.querySelector("button");
      expect(button).toBeInTheDocument();
    });

    it("opens popover when clicking trigger", async () => {
      const user = userEvent.setup();
      render(<RowHeightToggle />, { wrapper: Wrapper });

      const trigger = document.querySelector("button");
      await user.click(trigger!);

      await waitFor(() => {
        expect(screen.getByText("Row height")).toBeInTheDocument();
      });
    });

    it("shows Compact and Expanded options in popover", async () => {
      const user = userEvent.setup();
      render(<RowHeightToggle />, { wrapper: Wrapper });

      const trigger = document.querySelector("button");
      await user.click(trigger!);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
        expect(screen.getByText("Expanded")).toBeInTheDocument();
      });
    });
  });

  describe("Mode switching", () => {
    it("defaults to compact mode", () => {
      const store = useEvaluationsV3Store.getState();
      expect(store.ui.rowHeightMode).toBe("compact");
    });

    it("switches to expanded mode when clicking Expanded option", async () => {
      const user = userEvent.setup();
      render(<RowHeightToggle />, { wrapper: Wrapper });

      const trigger = document.querySelector("button");
      await user.click(trigger!);

      await waitFor(() => {
        expect(screen.getByText("Expanded")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Expanded"));

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("expanded");
    });

    it("switches back to compact mode when clicking Compact option", async () => {
      const user = userEvent.setup();

      // Start in expanded mode
      useEvaluationsV3Store.getState().setRowHeightMode("expanded");

      render(<RowHeightToggle />, { wrapper: Wrapper });

      const trigger = document.querySelector("button");
      await user.click(trigger!);

      await waitFor(() => {
        expect(screen.getByText("Compact")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Compact"));

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.rowHeightMode).toBe("compact");
    });
  });
});
