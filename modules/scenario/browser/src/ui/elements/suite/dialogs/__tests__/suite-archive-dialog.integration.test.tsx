/**
 * The archive confirmation dialog: what it asks, and what it does while an archive runs.
 * @vitest-environment jsdom
 * @see specs/features/suites/rename-suites-to-runs.feature
 * @see specs/features/suites/suite-archive-confirmation-dialog.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuiteArchiveDialog } from "../suite-archive-dialog.tsx";

function renderDialog(props: Partial<React.ComponentProps<typeof SuiteArchiveDialog>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  renderWithDesignSystem(
    <SuiteArchiveDialog
      open
      onClose={onClose}
      onConfirm={onConfirm}
      suiteName="Smoke Tests"
      {...props}
    />,
  );
  return { onClose, onConfirm };
}

afterEach(cleanup);

describe("<SuiteArchiveDialog/>", () => {
  describe("when a run plan is being archived", () => {
    /** @scenario Archive confirmation dialog uses "run plan" */
    it("asks Archive run plan? and says archived run plans leave the sidebar", () => {
      renderDialog();

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Archive run plan?")).toBeInTheDocument();
      expect(within(dialog).getByText("Smoke Tests")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Archived run plans will no longer appear/),
      ).toBeInTheDocument();
    });
  });

  describe("when the archive request is in progress", () => {
    /** @scenario "Buttons are disabled while archive is in progress" */
    it("disables the Cancel button and the Archive button", () => {
      renderDialog({ isLoading: true });

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons.filter((button) => button.hasAttribute("disabled"))).toHaveLength(2);
    });
  });
});
