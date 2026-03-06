/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteRunConfirmationDialog component.
 *
 * Tests that the run confirmation modal displays suite name,
 * scenario/target/job counts, Cancel and Run buttons, and fires correct callbacks.
 *
 * @see specs/features/suites/suite-run-confirmation-modal.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteRunConfirmationDialog } from "../SuiteRunConfirmationDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
    it("displays 'Run suite?' as the title", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Run suite?")).toBeInTheDocument();
    });

    it("displays the suite name", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Regression Tests")).toBeInTheDocument();
    });

    it("displays the scenario count", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("scenarios")).toBeInTheDocument();
    });

    it("displays the target count", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("targets")).toBeInTheDocument();
    });

    it("displays the estimated job count as scenarios x targets", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("6")).toBeInTheDocument();
      expect(screen.getByText("estimated jobs")).toBeInTheDocument();
    });

    it("has Cancel and Run buttons", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Run")).toBeInTheDocument();
    });
  });

  describe("when Cancel is clicked", () => {
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <SuiteRunConfirmationDialog {...defaultProps} onClose={onClose} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <SuiteRunConfirmationDialog
          {...defaultProps}
          onConfirm={onConfirm}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when Run is clicked", () => {
    it("calls onConfirm", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <SuiteRunConfirmationDialog
          {...defaultProps}
          onConfirm={onConfirm}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Run"));
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });

  describe("when isLoading is true", () => {
    it("disables the Cancel button", () => {
      render(
        <SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />,
        { wrapper: Wrapper },
      );

      const cancelButton = screen.getByText("Cancel").closest("button");
      expect(cancelButton).toBeDisabled();
    });

    it("disables the Run button", () => {
      render(
        <SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />,
        { wrapper: Wrapper },
      );

      // When loading, the Run button shows a spinner instead of text
      const buttons = screen.getAllByRole("button");
      const runButton = buttons.find(
        (btn) =>
          btn.textContent !== "Cancel" && !btn.getAttribute("aria-label"),
      );
      expect(runButton).toBeDisabled();
    });

    it("shows a loading spinner instead of Run text", () => {
      render(
        <SuiteRunConfirmationDialog {...defaultProps} isLoading={true} />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("Run")).not.toBeInTheDocument();
      expect(document.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });

  describe("when scenario count uses singular form", () => {
    it("displays 'scenario' for count of 1", () => {
      render(
        <SuiteRunConfirmationDialog
          {...defaultProps}
          scenarioCount={1}
          targetCount={1}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("scenario")).toBeInTheDocument();
      expect(screen.getByText("target")).toBeInTheDocument();
      expect(screen.getByText("estimated job")).toBeInTheDocument();
    });
  });
});
