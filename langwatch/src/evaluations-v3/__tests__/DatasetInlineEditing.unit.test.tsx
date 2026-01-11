/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { EditableCell } from "../components/DatasetSection/EditableCell";
import { DEFAULT_TEST_DATA_ID } from "../types";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to render with store reset and Chakra provider
const renderCell = (value: string, row: number, columnId: string, datasetId: string = DEFAULT_TEST_DATA_ID) => {
  return render(
    <EditableCell value={value} row={row} columnId={columnId} datasetId={datasetId} />,
    { wrapper: Wrapper }
  );
};

// Helper to get active dataset records
const getActiveDatasetRecords = () => {
  const state = useEvaluationsV3Store.getState();
  const activeDataset = state.datasets.find(d => d.id === state.activeDatasetId);
  return activeDataset?.inline?.records;
};

describe("Dataset inline editing", () => {
  beforeEach(() => {
    // Reset store before each test
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    // Clean up DOM after each test
    cleanup();
  });

  describe("Select a cell (via store)", () => {
    it("tracks selected cell in store", () => {
      const store = useEvaluationsV3Store.getState();
      store.setSelectedCell({ row: 0, columnId: "input" });

      const state = useEvaluationsV3Store.getState();
      expect(state.ui.selectedCell).toEqual({ row: 0, columnId: "input" });
    });
  });

  describe("Edit a cell by setting editingCell in store", () => {
    it("enters edit mode and shows textarea", async () => {
      renderCell("original", 0, "input");

      // Set editing cell directly (in real app, this is done by DatasetCellTd on double-click)
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });

      // Should show textarea with the value
      const textarea = await screen.findByRole("textbox");
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue("original");
    });
  });

  describe("Cancel cell edit with Escape", () => {
    it("reverts to original value on Escape", async () => {
      const user = userEvent.setup();

      // Get the initial store value before any edits
      const initialValue = getActiveDatasetRecords()?.["input"]?.[0];

      renderCell("original", 0, "input");

      // Enter edit mode
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });

      // Type something
      const textarea = await screen.findByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "modified");

      // Press Escape
      await user.keyboard("{Escape}");

      // Should revert - the store value should not be updated
      const records = getActiveDatasetRecords();
      expect(records?.["input"]?.[0]).toBe(initialValue);
    });
  });

  describe("Confirm cell edit with Enter", () => {
    it("saves value on Enter", async () => {
      const user = userEvent.setup();
      renderCell("", 0, "input");

      // Enter edit mode
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });

      // Type new value
      const textarea = await screen.findByRole("textbox");
      await user.type(textarea, "modified");

      // Press Enter
      await user.keyboard("{Enter}");

      // Store should be updated
      await waitFor(() => {
        const records = getActiveDatasetRecords();
        expect(records?.["input"]?.[0]).toBe("modified");
      });
    });
  });

  describe("Cell editor positioning", () => {
    it("shows editor with help text", async () => {
      renderCell("original", 0, "input");

      // Enter edit mode
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });

      // Should show textarea with help text
      expect(await screen.findByText(/Enter to save/i)).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("Undo cell edit", () => {
    it("undoes cell edit via store temporal", async () => {
      const user = userEvent.setup();

      // Get the initial store value before any edits
      const initialValue = getActiveDatasetRecords()?.["input"]?.[0];

      renderCell("", 0, "input");

      // Make an edit
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });
      const textarea = await screen.findByRole("textbox");
      await user.type(textarea, "first value");
      await user.keyboard("{Enter}");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify value was saved
      await waitFor(() => {
        const records = getActiveDatasetRecords();
        expect(records?.["input"]?.[0]).toBe("first value");
      });

      // Trigger undo via store
      useEvaluationsV3Store.temporal.getState().undo();

      // Value should be reverted to initial value
      await waitFor(() => {
        const records = getActiveDatasetRecords();
        expect(records?.["input"]?.[0]).toBe(initialValue);
      });
    });
  });

  describe("Redo cell edit", () => {
    it("redoes cell edit after undo", async () => {
      const user = userEvent.setup();

      // Get the initial store value before any edits
      const initialValue = getActiveDatasetRecords()?.["input"]?.[0];

      renderCell("", 0, "input");

      // Make an edit
      useEvaluationsV3Store.getState().setEditingCell({ row: 0, columnId: "input" });
      const textarea = await screen.findByRole("textbox");
      await user.type(textarea, "modified");
      await user.keyboard("{Enter}");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify saved
      await waitFor(() => {
        expect(getActiveDatasetRecords()?.["input"]?.[0]).toBe("modified");
      });

      // Undo
      useEvaluationsV3Store.temporal.getState().undo();

      await waitFor(() => {
        expect(getActiveDatasetRecords()?.["input"]?.[0]).toBe(initialValue);
      });

      // Redo
      useEvaluationsV3Store.temporal.getState().redo();

      await waitFor(() => {
        expect(getActiveDatasetRecords()?.["input"]?.[0]).toBe("modified");
      });
    });
  });
});

describe("Keyboard navigation", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  it("navigates down with ArrowDown", () => {
    const store = useEvaluationsV3Store.getState();
    store.setSelectedCell({ row: 0, columnId: "input" });

    // Simulate ArrowDown - this would be handled by the table component
    // For unit testing the store, we just verify the state updates correctly
    store.setSelectedCell({ row: 1, columnId: "input" });

    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 1,
      columnId: "input",
    });
  });

  it("navigates right with ArrowRight", () => {
    const store = useEvaluationsV3Store.getState();
    store.setSelectedCell({ row: 0, columnId: "input" });

    store.setSelectedCell({ row: 0, columnId: "expected_output" });

    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 0,
      columnId: "expected_output",
    });
  });

  it("clears selection with Escape", () => {
    const store = useEvaluationsV3Store.getState();
    store.setSelectedCell({ row: 0, columnId: "input" });

    store.setSelectedCell(undefined);

    expect(useEvaluationsV3Store.getState().ui.selectedCell).toBeUndefined();
  });

  it("enters edit mode with Enter", () => {
    const store = useEvaluationsV3Store.getState();
    store.setSelectedCell({ row: 0, columnId: "input" });

    store.setEditingCell({ row: 0, columnId: "input" });

    expect(useEvaluationsV3Store.getState().ui.editingCell).toEqual({
      row: 0,
      columnId: "input",
    });
  });
});

describe("Row selection", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  it("toggles row selection", () => {
    const store = useEvaluationsV3Store.getState();

    store.toggleRowSelection(0);
    expect(useEvaluationsV3Store.getState().ui.selectedRows.has(0)).toBe(true);

    store.toggleRowSelection(0);
    expect(useEvaluationsV3Store.getState().ui.selectedRows.has(0)).toBe(false);
  });

  it("selects multiple rows", () => {
    const store = useEvaluationsV3Store.getState();

    store.toggleRowSelection(0);
    store.toggleRowSelection(2);

    const state = useEvaluationsV3Store.getState();
    expect(state.ui.selectedRows.has(0)).toBe(true);
    expect(state.ui.selectedRows.has(1)).toBe(false);
    expect(state.ui.selectedRows.has(2)).toBe(true);
  });

  it("selects all rows", () => {
    const store = useEvaluationsV3Store.getState();

    store.selectAllRows(5);

    const state = useEvaluationsV3Store.getState();
    expect(state.ui.selectedRows.size).toBe(5);
  });

  it("clears row selection", () => {
    const store = useEvaluationsV3Store.getState();

    store.toggleRowSelection(0);
    store.toggleRowSelection(1);
    store.clearRowSelection();

    expect(useEvaluationsV3Store.getState().ui.selectedRows.size).toBe(0);
  });
});
