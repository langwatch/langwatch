/**
 * SuiteRunConfirmationDialog with scenario/target breakdown.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuiteRunConfirmationDialog } from "../../elements/dialogs/suite-run-confirmation-dialog.tsx";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  suiteName: "Regression Tests",
  scenarioCount: 3,
  targetCount: 2,
  isLoading: false,
};

describe("<SuiteRunConfirmationDialog/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given the dialog is open", () => {
    it("displays the estimated run count in the title", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.getByText(/Run 6 simulations\?/)).toBeInTheDocument();
    });

    it("displays the suite name", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.getByText("Regression Tests")).toBeInTheDocument();
    });

    it("displays scenario and target counts", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("scenarios")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("targets")).toBeInTheDocument();
    });

    it("displays the job count in the Run button", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.getByText("Run 6 Jobs")).toBeInTheDocument();
    });

    it("has a Cancel button", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });

  describe("when Cancel is clicked", () => {
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithDesignSystem(
        <SuiteRunConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
      );

      await user.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when Run button is clicked", () => {
    it("calls onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      renderWithDesignSystem(
        <SuiteRunConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
      );

      await user.click(screen.getByText("Run 6 Jobs"));
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  describe("when isLoading is true", () => {
    it("disables the Cancel button", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />);

      const cancelButton = screen.getByText("Cancel").closest("button");
      expect(cancelButton).toBeDisabled();
    });

    it("disables the Run button", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />);

      const buttons = screen.getAllByRole("button");
      const runButton = buttons.find(
        (btn) => btn.textContent !== "Cancel" && !btn.getAttribute("aria-label"),
      );
      expect(runButton).toBeDisabled();
    });

    it("shows a loading spinner instead of Run text", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />);

      expect(screen.queryByText(/Run \d+ Jobs/)).not.toBeInTheDocument();
      expect(document.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });

  describe("when repeatCount is greater than 1", () => {
    it("displays the repeat count", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} repeatCount={2} />);

      expect(screen.getByText("2x")).toBeInTheDocument();
      expect(screen.getByText("repeats")).toBeInTheDocument();
    });

    it("multiplies estimated jobs by repeatCount", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} repeatCount={3} />);

      // 3 scenarios * 2 targets * 3 repeats = 18
      expect(screen.getByText(/Run 18 simulations\?/)).toBeInTheDocument();
      expect(screen.getByText("Run 18 Jobs")).toBeInTheDocument();
    });
  });

  describe("when repeatCount is 1 or omitted", () => {
    it("does not display repeats in the breakdown", () => {
      renderWithDesignSystem(<SuiteRunConfirmationDialog {...defaultProps} />);

      expect(screen.queryByText(/repeats/)).not.toBeInTheDocument();
    });
  });

  describe("when using singular forms", () => {
    it("displays singular nouns for count of 1", () => {
      renderWithDesignSystem(
        <SuiteRunConfirmationDialog {...defaultProps} scenarioCount={1} targetCount={1} />,
      );

      expect(screen.getByText("scenario")).toBeInTheDocument();
      expect(screen.getByText("target")).toBeInTheDocument();
      expect(screen.getByText(/Run 1 simulation\?/)).toBeInTheDocument();
      expect(screen.getByText("Run 1 Job")).toBeInTheDocument();
    });
  });
});
