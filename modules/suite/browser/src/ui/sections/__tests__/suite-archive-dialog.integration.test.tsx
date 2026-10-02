/**
 * SuiteArchiveDialog confirmation modal.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuiteArchiveDialog } from "../../elements/dialogs/suite-archive-dialog.tsx";

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
    /** @scenario "Archive confirmation dialog appears when archiving a suite" */
    /** @scenario 'Archive confirmation dialog uses "run plan"' */
    it("displays 'Archive run plan?' as the title", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} />);

      expect(screen.getByText("Archive run plan?")).toBeInTheDocument();
    });

    it("displays the suite name", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} />);

      expect(screen.getByText("Smoke Tests")).toBeInTheDocument();
    });

    it("explains that archiving preserves test runs", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} />);

      expect(
        screen.getByText(
          "Archived run plans will no longer appear in the sidebar. Test runs are preserved.",
        ),
      ).toBeInTheDocument();
    });

    it("has Cancel and Archive buttons", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Archive")).toBeInTheDocument();
    });
  });

  describe("when Cancel is clicked", () => {
    /** @scenario "Cancel dismisses the archive confirmation dialog without archiving" */
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when Archive is clicked", () => {
    /** @scenario "Confirm archives the suite" */
    it("calls onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByText("Archive"));
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  describe("when isLoading is true", () => {
    /** @scenario "Buttons are disabled while archive is in progress" */
    it("disables the Cancel button", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} isLoading={true} />);

      const cancelButton = screen.getByText("Cancel").closest("button");
      expect(cancelButton).toBeDisabled();
    });

    it("disables the Archive button", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} isLoading={true} />);

      // When loading, the Archive button shows a spinner instead of text
      const buttons = screen.getAllByRole("button");
      const archiveButton = buttons.find(
        (btn) => btn.textContent !== "Cancel" && !btn.getAttribute("aria-label"),
      );
      expect(archiveButton).toBeDisabled();
    });

    it("shows a loading spinner instead of Archive text", () => {
      renderWithDesignSystem(<SuiteArchiveDialog {...defaultProps} isLoading={true} />);

      expect(screen.queryByText("Archive")).not.toBeInTheDocument();
      expect(document.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });
});
