/**
 * Integration tests for ExportProgress component.
 * @vitest-environment jsdom
 * @see specs/traces/trace-export.feature — "Streaming Download and Progress" section
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportProgress } from "../export-progress.tsx";

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
      renderWithDesignSystem(<ExportProgress {...defaultProps} exported={0} total={500} />);

      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName.toLowerCase() === "p" && el.textContent === "Exported 0 of 500 traces…",
        ),
      ).toBeInTheDocument();
    });

    it("renders a progress bar", () => {
      renderWithDesignSystem(<ExportProgress {...defaultProps} exported={250} total={500} />);

      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
    });
  });

  describe("when progress updates", () => {
    it("updates the text to reflect new exported count", () => {
      const { rerender } = renderWithDesignSystem(
        <ExportProgress {...defaultProps} exported={100} total={500} />,
      );

      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName.toLowerCase() === "p" && el.textContent === "Exported 100 of 500 traces…",
        ),
      ).toBeInTheDocument();

      rerender(<ExportProgress {...defaultProps} exported={300} total={500} />);

      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName.toLowerCase() === "p" && el.textContent === "Exported 300 of 500 traces…",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when export completes", () => {
    it("shows completion text", () => {
      renderWithDesignSystem(<ExportProgress {...defaultProps} exported={500} total={500} />);

      expect(screen.getByText("Exported 500 traces")).toBeInTheDocument();
    });
  });

  describe("when isExporting is false", () => {
    it("renders nothing", () => {
      const { container } = renderWithDesignSystem(
        <ExportProgress exported={0} total={500} isExporting={false} />,
      );

      expect(container.textContent).toBe("");
    });
  });

  describe("when onCancel is provided", () => {
    it("shows a cancel button", () => {
      renderWithDesignSystem(<ExportProgress {...defaultProps} onCancel={vi.fn()} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("calls onCancel when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();

      renderWithDesignSystem(<ExportProgress {...defaultProps} onCancel={onCancel} />);

      await user.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe("when onCancel is not provided", () => {
    it("does not show a cancel button", () => {
      renderWithDesignSystem(<ExportProgress {...defaultProps} />);

      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    });
  });
});
