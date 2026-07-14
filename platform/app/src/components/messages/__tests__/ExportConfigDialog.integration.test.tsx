/**
 * @vitest-environment jsdom
 *
 * Integration tests for ExportConfigDialog component.
 *
 * Tests that the export configuration dialog renders mode/format toggles,
 * trace count, and fires onExport with the correct config.
 *
 * @see specs/traces/trace-export.feature — "Export Config Dialog" section
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportConfigDialog } from "../ExportConfigDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Export Traces")).toBeInTheDocument();
    });

    it("displays the trace count", () => {
      render(<ExportConfigDialog {...defaultProps} traceCount={500} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("500 traces")).toBeInTheDocument();
    });

    it("defaults mode to Summary", () => {
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      const summaryRadio = screen.getByLabelText("Summary");
      expect(summaryRadio).toBeChecked();
    });

    it("defaults format to CSV", () => {
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      const csvRadio = screen.getByLabelText("CSV");
      expect(csvRadio).toBeChecked();
    });

    it("shows description 'One row per trace' for Summary mode", () => {
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("One row per trace")).toBeInTheDocument();
    });

    it("shows description for Full mode", () => {
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(
        screen.getByText("One row per span, includes inputs/outputs")
      ).toBeInTheDocument();
    });

    it("has Cancel and Export buttons", () => {
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Export")).toBeInTheDocument();
    });
  });

  describe("when isSelectedExport is true", () => {
    it("displays 'X selected traces' in the subtitle", () => {
      render(
        <ExportConfigDialog
          {...defaultProps}
          traceCount={5}
          isSelectedExport={true}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("5 selected traces")).toBeInTheDocument();
    });
  });

  describe("when traceCount is >= 10000", () => {
    it("shows '(limit)' next to the count", () => {
      render(
        <ExportConfigDialog {...defaultProps} traceCount={10000} />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("10,000 traces (limit)")).toBeInTheDocument();
    });
  });

  describe("when user selects Full mode", () => {
    it("updates the mode selection", async () => {
      const user = userEvent.setup();
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      await user.click(screen.getByLabelText("Full"));

      expect(screen.getByLabelText("Full")).toBeChecked();
      expect(screen.getByLabelText("Summary")).not.toBeChecked();
    });
  });

  describe("when user selects JSON format", () => {
    it("updates the format selection", async () => {
      const user = userEvent.setup();
      render(<ExportConfigDialog {...defaultProps} />, { wrapper: Wrapper });

      await user.click(screen.getByLabelText("JSON"));

      expect(screen.getByLabelText("JSON")).toBeChecked();
      expect(screen.getByLabelText("CSV")).not.toBeChecked();
    });
  });

  describe("when user clicks Export with default settings", () => {
    it("calls onExport with summary mode and csv format", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(
        <ExportConfigDialog {...defaultProps} onExport={onExport} />,
        { wrapper: Wrapper }
      );

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
      render(
        <ExportConfigDialog {...defaultProps} onExport={onExport} />,
        { wrapper: Wrapper }
      );

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
      render(
        <ExportConfigDialog {...defaultProps} onClose={onClose} />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByText("Cancel"));

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("does not call onExport", async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(
        <ExportConfigDialog {...defaultProps} onExport={onExport} />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByText("Cancel"));

      expect(onExport).not.toHaveBeenCalled();
    });
  });
});
