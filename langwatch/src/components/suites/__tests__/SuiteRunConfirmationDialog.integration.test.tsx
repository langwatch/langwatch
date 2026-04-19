/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteRunConfirmationDialog component.
 *
 * Tests that the run confirmation modal displays suite name,
 * scenario/target breakdown, job count in title and button, and fires correct callbacks.
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
    it("displays the estimated run count in the title", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByText(/Run 6 simulations\?/),
      ).toBeInTheDocument();
    });

    it("displays the suite name", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Regression Tests")).toBeInTheDocument();
    });

    it("displays scenario and target counts", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("scenarios")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("targets")).toBeInTheDocument();
    });

    it("displays the job count in the Run button", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Run 6 Jobs")).toBeInTheDocument();
    });

    it("has a Cancel button", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Cancel")).toBeInTheDocument();
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

  describe("when Run button is clicked", () => {
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

      await user.click(screen.getByText("Run 6 Jobs"));
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

      expect(screen.queryByText(/Run \d+ Jobs/)).not.toBeInTheDocument();
      expect(document.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });

  describe("when repeatCount is greater than 1", () => {
    it("displays the repeat count", () => {
      render(
        <SuiteRunConfirmationDialog {...defaultProps} repeatCount={2} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("2x")).toBeInTheDocument();
      expect(screen.getByText("repeats")).toBeInTheDocument();
    });

    it("multiplies estimated jobs by repeatCount", () => {
      render(
        <SuiteRunConfirmationDialog {...defaultProps} repeatCount={3} />,
        { wrapper: Wrapper },
      );

      // 3 scenarios * 2 targets * 3 repeats = 18
      expect(
        screen.getByText(/Run 18 simulations\?/),
      ).toBeInTheDocument();
      expect(screen.getByText("Run 18 Jobs")).toBeInTheDocument();
    });
  });

  describe("when repeatCount is 1 or omitted", () => {
    it("does not display repeats in the breakdown", () => {
      render(<SuiteRunConfirmationDialog {...defaultProps} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByText(/repeats/)).not.toBeInTheDocument();
    });
  });

  describe("when using singular forms", () => {
    it("displays singular nouns for count of 1", () => {
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
      expect(
        screen.getByText(/Run 1 simulation\?/),
      ).toBeInTheDocument();
      expect(screen.getByText("Run 1 Job")).toBeInTheDocument();
    });
  });
});
