/**
 * @vitest-environment jsdom
 *
 * Integration tests for ExportProgress component.
 *
 * Tests that the progress indicator displays correct text, progress bar,
 * and cancel button during trace export.
 *
 * @see specs/traces/trace-export.feature — "Streaming Download and Progress" section
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportProgress } from "../ExportProgress";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const defaultProps = {
  exported: 0,
  total: 500,
  isExporting: true,
};

describe("<ExportProgress/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when isExporting is true", () => {
    it("shows progress text with exported and total counts", () => {
      render(<ExportProgress {...defaultProps} exported={0} total={500} />, {
        wrapper: Wrapper,
      });

      expect(
        screen.getByText("Exported 0 of 500 traces...")
      ).toBeInTheDocument();
    });

    it("renders a progress bar", () => {
      render(<ExportProgress {...defaultProps} exported={250} total={500} />, {
        wrapper: Wrapper,
      });

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
    });
  });

  describe("when progress updates", () => {
    it("updates the text to reflect new exported count", () => {
      const { rerender } = render(
        <ExportProgress {...defaultProps} exported={100} total={500} />,
        { wrapper: Wrapper }
      );

      expect(
        screen.getByText("Exported 100 of 500 traces...")
      ).toBeInTheDocument();

      rerender(
        <Wrapper>
          <ExportProgress {...defaultProps} exported={300} total={500} />
        </Wrapper>
      );

      expect(
        screen.getByText("Exported 300 of 500 traces...")
      ).toBeInTheDocument();
    });
  });

  describe("when export completes", () => {
    it("shows completion text", () => {
      render(
        <ExportProgress {...defaultProps} exported={500} total={500} />,
        { wrapper: Wrapper }
      );

      expect(
        screen.getByText("Exported 500 traces")
      ).toBeInTheDocument();
    });
  });

  describe("when isExporting is false", () => {
    it("renders nothing", () => {
      const { container } = render(
        <ExportProgress
          exported={0}
          total={500}
          isExporting={false}
        />,
        { wrapper: Wrapper }
      );

      expect(container.textContent).toBe("");
    });
  });

  describe("when onCancel is provided", () => {
    it("shows a cancel button", () => {
      render(
        <ExportProgress {...defaultProps} onCancel={vi.fn()} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("calls onCancel when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();

      render(
        <ExportProgress {...defaultProps} onCancel={onCancel} />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe("when onCancel is not provided", () => {
    it("does not show a cancel button", () => {
      render(<ExportProgress {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    });
  });
});
