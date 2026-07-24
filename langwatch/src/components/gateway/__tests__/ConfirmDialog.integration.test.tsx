/**
 * @vitest-environment jsdom
 *
 * Tests for the reusable ConfirmDialog component that replaces window.confirm
 * across the app (see #4141). Covers the contract its call sites rely on:
 * open/close visibility, confirm/cancel callbacks, custom labels, and the
 * loading state that guards against double-submits during a mutation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../ConfirmDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("given a ConfirmDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Delete saved view",
    message: 'Delete "My View" saved view?',
    onConfirm: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when open", () => {
    it("renders the title and message", async () => {
      render(<ConfirmDialog {...defaultProps} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Delete saved view")).toBeInTheDocument();
        expect(
          screen.getByText('Delete "My View" saved view?'),
        ).toBeInTheDocument();
      });
    });

    it("uses the default confirm label when none is provided", async () => {
      render(<ConfirmDialog {...defaultProps} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Confirm" }),
        ).toBeInTheDocument();
      });
    });

    it("renders a custom confirm label", async () => {
      render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Delete" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when closed", () => {
    it("does not render the message", () => {
      render(<ConfirmDialog {...defaultProps} open={false} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.queryByText('Delete "My View" saved view?'),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the confirm button is clicked", () => {
    it("calls onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <ConfirmDialog
          {...defaultProps}
          confirmLabel="Delete"
          onConfirm={onConfirm}
        />,
        { wrapper: Wrapper },
      );

      await user.click(await screen.findByRole("button", { name: "Delete" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the cancel button is clicked", () => {
    it("requests close via onOpenChange(false) without confirming", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const onConfirm = vi.fn();

      render(
        <ConfirmDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />,
        { wrapper: Wrapper },
      );

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when loading", () => {
    it("disables the cancel button so the action cannot be aborted mid-flight", async () => {
      render(<ConfirmDialog {...defaultProps} loading={true} />, {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      });
    });
  });
});
