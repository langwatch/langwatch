/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteArchiveDialog component.
 *
 * Tests that the archive confirmation modal displays suite name,
 * explanation text, Cancel and Archive buttons, and fires correct callbacks.
 *
 * @see specs/suites/suite-archiving.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteArchiveDialog } from "../SuiteArchiveDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  suiteName: "Smoke Tests",
  isLoading: false,
};

describe("<SuiteArchiveDialog/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given the dialog is open", () => {
    it("displays 'Archive suite?' as the title", () => {
      render(<SuiteArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Archive suite?")).toBeInTheDocument();
    });

    it("displays the suite name", () => {
      render(<SuiteArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Smoke Tests")).toBeInTheDocument();
    });

    it("explains that archiving preserves test runs", () => {
      render(<SuiteArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(
        screen.getByText("Archived suites will no longer appear in the sidebar. Test runs are preserved."),
      ).toBeInTheDocument();
    });

    it("has Cancel and Archive buttons", () => {
      render(<SuiteArchiveDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Archive")).toBeInTheDocument();
    });
  });

  describe("when Cancel is clicked", () => {
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<SuiteArchiveDialog {...defaultProps} onClose={onClose} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(<SuiteArchiveDialog {...defaultProps} onConfirm={onConfirm} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when Archive is clicked", () => {
    it("calls onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(<SuiteArchiveDialog {...defaultProps} onConfirm={onConfirm} />, { wrapper: Wrapper });

      await user.click(screen.getByText("Archive"));
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  describe("when isLoading is true", () => {
    it("disables the Cancel button", () => {
      render(<SuiteArchiveDialog {...defaultProps} isLoading={true} />, { wrapper: Wrapper });

      const cancelButton = screen.getByText("Cancel").closest("button");
      expect(cancelButton).toBeDisabled();
    });

    it("disables the Archive button", () => {
      render(<SuiteArchiveDialog {...defaultProps} isLoading={true} />, { wrapper: Wrapper });

      // When loading, the Archive button shows a spinner instead of text
      const buttons = screen.getAllByRole("button");
      const archiveButton = buttons.find(
        (btn) => btn.textContent !== "Cancel" && !btn.getAttribute("aria-label"),
      );
      expect(archiveButton).toBeDisabled();
    });

    it("shows a loading spinner instead of Archive text", () => {
      render(<SuiteArchiveDialog {...defaultProps} isLoading={true} />, { wrapper: Wrapper });

      expect(screen.queryByText("Archive")).not.toBeInTheDocument();
      expect(document.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });
});
