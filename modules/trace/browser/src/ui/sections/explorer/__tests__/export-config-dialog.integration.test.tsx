/**
 * Integration tests for ExportConfigDialog component.
 * @vitest-environment jsdom
 * @see specs/traces/trace-export.feature — "Export Config Dialog" section
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportConfigDialog } from "../export-config-dialog.tsx";

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onExport: vi.fn(),
  traceCount: 500,
  isSelectedExport: false,
};

describe("<ExportConfigDialog/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given the dialog is open", () => {
    it("displays 'Export Traces' as the title", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      expect(screen.getByText("Export Traces")).toBeInTheDocument();
    });

    it("displays the trace count", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} traceCount={500} />);

      expect(screen.getByText("500 traces")).toBeInTheDocument();
    });

    it("defaults mode to Summary", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      const summaryRadio = screen.getByLabelText("Summary");
      expect(summaryRadio).toBeChecked();
    });

    it("defaults format to CSV", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      const csvRadio = screen.getByLabelText("CSV");
      expect(csvRadio).toBeChecked();
    });

    it("shows description 'One row per trace' for Summary mode", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      expect(screen.getByText("One row per trace")).toBeInTheDocument();
    });

    it("shows description for Full mode", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      expect(screen.getByText("One row per span, includes inputs/outputs")).toBeInTheDocument();
    });

    it("has Cancel and Export buttons", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Export")).toBeInTheDocument();
    });
  });

  describe("when isSelectedExport is true", () => {
    it("displays 'X selected traces' in the subtitle", () => {
      renderWithDesignSystem(
        <ExportConfigDialog {...defaultProps} traceCount={5} isSelectedExport={true} />,
      );

      expect(screen.getByText("5 selected traces")).toBeInTheDocument();
    });
  });

  describe("when traceCount is >= 10000", () => {
    it("shows '(limit)' next to the count", () => {
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} traceCount={10000} />);

      expect(screen.getByText("10,000 traces (limit)")).toBeInTheDocument();
    });
  });

  describe("when user selects Full mode", () => {
    it("updates the mode selection", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      await user.click(screen.getByLabelText("Full"));

      expect(screen.getByLabelText("Full")).toBeChecked();
      expect(screen.getByLabelText("Summary")).not.toBeChecked();
    });
  });

  describe("when user selects JSON format", () => {
    it("updates the format selection", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} />);

      await user.click(screen.getByLabelText("JSON"));

      expect(screen.getByLabelText("JSON")).toBeChecked();
      expect(screen.getByLabelText("CSV")).not.toBeChecked();
    });
  });

  describe("when user clicks Export with default settings", () => {
    it("calls onExport with summary mode and csv format", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} onExport={onExport} />);

      await user.click(screen.getByText("Export"));

      expect(onExport).toHaveBeenCalledWith({
        mode: "summary",
        format: "csv",
      });
    });
  });

  describe("when user selects Full + JSON and clicks Export", () => {
    it("calls onExport with full mode and json format", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} onExport={onExport} />);

      await user.click(screen.getByLabelText("Full"));
      await user.click(screen.getByLabelText("JSON"));
      await user.click(screen.getByText("Export"));

      expect(onExport).toHaveBeenCalledWith({
        mode: "full",
        format: "json",
      });
    });
  });

  describe("when user clicks Cancel", () => {
    it("calls onClose", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByText("Cancel"));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onExport", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      renderWithDesignSystem(<ExportConfigDialog {...defaultProps} onExport={onExport} />);

      await user.click(screen.getByText("Cancel"));

      expect(onExport).not.toHaveBeenCalled();
    });
  });
});
