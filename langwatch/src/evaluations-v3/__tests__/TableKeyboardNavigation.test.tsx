/**
 * @vitest-environment jsdom
 */
import React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTableKeyboardNavigation } from "../hooks/useTableKeyboardNavigation";
import type { DatasetColumn } from "../types";

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    isOpen: vi.fn(() => false),
    drawerParams: {},
    drawerOpen: () => false,
  }),
  getComplexProps: () => ({}),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Minimal component to test keyboard navigation behavior using the extracted hook.
 */
const KeyboardNavigationTestComponent = () => {
  const {
    datasets,
    activeDatasetId,
    targets,
    ui,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
    getRowCount,
  } = useEvaluationsV3Store((state) => ({
    datasets: state.datasets,
    activeDatasetId: state.activeDatasetId,
    targets: state.targets,
    ui: state.ui,
    setSelectedCell: state.setSelectedCell,
    setEditingCell: state.setEditingCell,
    toggleRowSelection: state.toggleRowSelection,
    getRowCount: state.getRowCount,
  }));

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const datasetColumns: DatasetColumn[] = activeDataset?.columns ?? [];
  const rowCount = getRowCount(activeDatasetId);
  const displayRowCount = Math.max(rowCount, 3);

  // Use the extracted keyboard navigation hook
  const allColumns = useTableKeyboardNavigation({
    datasetColumns,
    targets,
    displayRowCount,
    editingCell: ui.editingCell,
    selectedCell: ui.selectedCell,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  });

  return (
    <div data-testid="keyboard-nav-test">
      <div data-testid="selected-cell">
        {ui.selectedCell
          ? `${ui.selectedCell.row}:${ui.selectedCell.columnId}`
          : "none"}
      </div>
      <div data-testid="editing-cell">
        {ui.editingCell
          ? `${ui.editingCell.row}:${ui.editingCell.columnId}`
          : "none"}
      </div>
      <div data-testid="selected-rows">
        {Array.from(ui.selectedRows).join(",")}
      </div>
      <div data-testid="columns">
        {allColumns.map((c) => c.id).join(",")}
      </div>
    </div>
  );
};

describe("Table keyboard navigation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Arrow key navigation", () => {
    it("navigates down with ArrowDown key", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Set initial selection
      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      // Press ArrowDown
      fireEvent.keyDown(document, { key: "ArrowDown" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:input");
      });
    });

    it("navigates up with ArrowUp key", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Set initial selection at row 1
      useEvaluationsV3Store.getState().setSelectedCell({ row: 1, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:input");
      });

      // Press ArrowUp
      fireEvent.keyDown(document, { key: "ArrowUp" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });

    it("navigates right with ArrowRight key", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Set initial selection on checkbox column
      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "__checkbox__" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });

      // Press ArrowRight
      fireEvent.keyDown(document, { key: "ArrowRight" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });

    it("navigates left with ArrowLeft key", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Set initial selection on input column
      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      // Press ArrowLeft
      fireEvent.keyDown(document, { key: "ArrowLeft" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });
    });

    it("does not navigate up past row 0", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      // Press ArrowUp at row 0
      fireEvent.keyDown(document, { key: "ArrowUp" });

      // Should stay at row 0
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });

    it("does not navigate left past first column", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "__checkbox__" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });

      // Press ArrowLeft at first column
      fireEvent.keyDown(document, { key: "ArrowLeft" });

      // Should stay at first column
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });
    });
  });

  describe("Tab navigation", () => {
    it("moves to next column with Tab", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "__checkbox__" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });

      fireEvent.keyDown(document, { key: "Tab" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });

    it("moves to previous column with Shift+Tab", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:__checkbox__");
      });
    });

    it("wraps to next row at end of columns with Tab", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Navigate to the last column (expected_output for default store)
      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "expected_output" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:expected_output");
      });

      fireEvent.keyDown(document, { key: "Tab" });

      // Should wrap to first column of next row
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:__checkbox__");
      });
    });

    it("wraps to previous row at start of columns with Shift+Tab", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Start at first column of row 1
      useEvaluationsV3Store.getState().setSelectedCell({ row: 1, columnId: "__checkbox__" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:__checkbox__");
      });

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      // Should wrap to last column of previous row
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:expected_output");
      });
    });
  });

  describe("Enter/Space key actions", () => {
    it("toggles row selection when Enter pressed on checkbox column", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "__checkbox__" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-rows")).toHaveTextContent("");
      });

      fireEvent.keyDown(document, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-rows")).toHaveTextContent("0");
      });
    });

    it("toggles row selection when Space pressed on checkbox column", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 1, columnId: "__checkbox__" });

      // Wait for state to propagate
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("1:__checkbox__");
      });

      fireEvent.keyDown(document, { key: " ", code: "Space" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-rows")).toHaveTextContent("1");
      });
    });

    it("enters edit mode when Enter pressed on dataset column", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("none");
      });

      fireEvent.keyDown(document, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("0:input");
      });
    });

    it("enters edit mode when Space pressed on dataset column", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "expected_output" });

      // Wait for state to propagate
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:expected_output");
      });

      fireEvent.keyDown(document, { key: " ", code: "Space" });

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("0:expected_output");
      });
    });
  });

  describe("Escape key", () => {
    it("clears selection when Escape pressed", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("none");
      });
    });
  });

  describe("No selection", () => {
    it("does not respond to keys when no cell is selected", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Ensure no selection
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("none");
      });

      // Press various keys
      fireEvent.keyDown(document, { key: "ArrowDown" });
      fireEvent.keyDown(document, { key: "Enter" });

      // Should still have no selection
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("none");
      });
    });
  });

  describe("Edit mode blocking", () => {
    it("does not navigate when in edit mode", async () => {
      render(<KeyboardNavigationTestComponent />, { wrapper: Wrapper });

      // Set selection and enter edit mode
      useEvaluationsV3Store.getState().setSelectedCell({ row: 0, columnId: "input" });
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });

      await waitFor(() => {
        expect(screen.getByTestId("editing-cell")).toHaveTextContent("0:input");
      });

      // Try to navigate
      fireEvent.keyDown(document, { key: "ArrowDown" });

      // Should still be at same cell
      await waitFor(() => {
        expect(screen.getByTestId("selected-cell")).toHaveTextContent("0:input");
      });
    });
  });
});
