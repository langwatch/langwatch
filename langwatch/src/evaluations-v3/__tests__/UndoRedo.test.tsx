/**
 * @vitest-environment jsdom
 *
 * Tests for undo/redo functionality in the evaluations workbench.
 * Covers UI buttons, keyboard shortcuts, and store actions.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveStatus } from "../components/AutosaveStatus";
import { UndoRedo } from "../components/UndoRedo";
import {
  performRedo,
  performUndo,
  useEvaluationsV3Store,
} from "../hooks/useEvaluationsV3Store";

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("UndoRedo Component", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("UI buttons visibility", () => {
    it("renders undo and redo buttons", () => {
      render(<UndoRedo />, { wrapper: Wrapper });

      expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /redo/i })).toBeInTheDocument();
    });

    it("disables undo button when no history", () => {
      render(<UndoRedo />, { wrapper: Wrapper });

      const undoButton = screen.getByRole("button", { name: /undo/i });
      expect(undoButton).toBeDisabled();
    });

    it("disables redo button when no future state", () => {
      render(<UndoRedo />, { wrapper: Wrapper });

      const redoButton = screen.getByRole("button", { name: /redo/i });
      expect(redoButton).toBeDisabled();
    });

    it("enables undo button after making a change", async () => {
      render(<UndoRedo />, { wrapper: Wrapper });

      // Make a change
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "hello");

      // Wait for the debounce in temporal middleware
      await new Promise((resolve) => setTimeout(resolve, 150));

      await waitFor(() => {
        const undoButton = screen.getByRole("button", { name: /undo/i });
        expect(undoButton).not.toBeDisabled();
      });
    });

    it("enables redo button after undoing", async () => {
      render(<UndoRedo />, { wrapper: Wrapper });

      // Make a change
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "hello");
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Undo
      useEvaluationsV3Store.temporal.getState().undo();

      await waitFor(() => {
        const redoButton = screen.getByRole("button", { name: /redo/i });
        expect(redoButton).not.toBeDisabled();
      });
    });
  });

  describe("Button click actions", () => {
    it("undoes change when undo button is clicked", async () => {
      const user = userEvent.setup();
      render(<UndoRedo />, { wrapper: Wrapper });

      // Make two changes (temporal requires distinct state changes for history)
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "first");
      await new Promise((resolve) => setTimeout(resolve, 150));
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "second");
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify change was made
      expect(
        useEvaluationsV3Store.getState().getCellValue("test-data", 0, "input"),
      ).toBe("second");

      // Wait for button to be enabled
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /undo/i }),
        ).not.toBeDisabled();
      });

      // Click undo
      await user.click(screen.getByRole("button", { name: /undo/i }));

      // Verify change was undone - back to "first"
      expect(
        useEvaluationsV3Store.getState().getCellValue("test-data", 0, "input"),
      ).toBe("first");
    });

    it("redoes change when redo button is clicked", async () => {
      const user = userEvent.setup();
      render(<UndoRedo />, { wrapper: Wrapper });

      // Make two changes
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "first");
      await new Promise((resolve) => setTimeout(resolve, 150));
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "second");
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Undo
      useEvaluationsV3Store.temporal.getState().undo();
      expect(
        useEvaluationsV3Store.getState().getCellValue("test-data", 0, "input"),
      ).toBe("first");

      // Wait for redo button to be enabled
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /redo/i }),
        ).not.toBeDisabled();
      });

      // Click redo
      await user.click(screen.getByRole("button", { name: /redo/i }));

      // Verify change was redone
      expect(
        useEvaluationsV3Store.getState().getCellValue("test-data", 0, "input"),
      ).toBe("second");
    });
  });

  describe("Keyboard shortcuts", () => {
    // Note: These tests verify the keyboard handler is registered and respects
    // the textarea check. The actual undo/redo functionality is tested in the
    // store action tests below.

    it("does not trigger undo when in textarea", async () => {
      render(
        <div>
          <UndoRedo />
          <textarea data-testid="test-textarea" />
        </div>,
        { wrapper: Wrapper },
      );

      // Make two changes
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "first");
      await new Promise((resolve) => setTimeout(resolve, 150));
      useEvaluationsV3Store
        .getState()
        .setCellValue("test-data", 0, "input", "second");
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Focus textarea and simulate Cmd+Z
      const textarea = screen.getByTestId("test-textarea");
      textarea.focus();
      fireEvent.keyDown(textarea, { key: "z", metaKey: true });

      // Value should NOT be undone (keyboard shortcut should be ignored in textarea)
      expect(
        useEvaluationsV3Store.getState().getCellValue("test-data", 0, "input"),
      ).toBe("second");
    });
  });
});

describe("AutosaveStatus Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows Saved when both states are idle", () => {
    render(<AutosaveStatus evaluationState="idle" datasetState="idle" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows Saving when evaluation is saving", () => {
    render(<AutosaveStatus evaluationState="saving" datasetState="idle" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows Saving when dataset is saving", () => {
    render(<AutosaveStatus evaluationState="idle" datasetState="saving" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows Failed to save when evaluation has error", () => {
    render(
      <AutosaveStatus
        evaluationState="error"
        datasetState="idle"
        evaluationError="Network error"
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Failed to save")).toBeInTheDocument();
  });

  it("shows Failed to save when dataset has error", () => {
    render(
      <AutosaveStatus
        evaluationState="idle"
        datasetState="error"
        datasetError="Sync failed"
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Failed to save")).toBeInTheDocument();
  });
});

describe("Autosave status in store", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  it("initializes with idle states", () => {
    const status = useEvaluationsV3Store.getState().ui.autosaveStatus;
    expect(status.evaluation).toBe("idle");
    expect(status.dataset).toBe("idle");
  });

  it("updates evaluation status", () => {
    useEvaluationsV3Store.getState().setAutosaveStatus("evaluation", "saving");
    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation).toBe(
      "saving",
    );

    useEvaluationsV3Store.getState().setAutosaveStatus("evaluation", "saved");
    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.evaluation).toBe(
      "saved",
    );
  });

  it("updates dataset status with error", () => {
    useEvaluationsV3Store
      .getState()
      .setAutosaveStatus("dataset", "error", "Network error");
    expect(useEvaluationsV3Store.getState().ui.autosaveStatus.dataset).toBe(
      "error",
    );
    expect(
      useEvaluationsV3Store.getState().ui.autosaveStatus.datasetError,
    ).toBe("Network error");
  });
});

describe("Undo/Redo store actions (unit)", () => {
  beforeEach(async () => {
    useEvaluationsV3Store.getState().reset();
    // Wait for debounce to clear after reset
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  // Helper to get inline dataset records
  const getRecords = () => {
    const ds = useEvaluationsV3Store
      .getState()
      .datasets.find((d) => d.id === "test-data");
    return ds?.inline?.records;
  };

  it("undoes cell edit", async () => {
    const store = useEvaluationsV3Store.getState();

    // First change
    store.setCellValue("test-data", 0, "input", "first");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second change
    store.setCellValue("test-data", 0, "input", "second");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(getRecords()?.input?.[0]).toBe("second");

    // Undo - should go back to "first"
    useEvaluationsV3Store.temporal.getState().undo();

    expect(getRecords()?.input?.[0]).toBe("first");
  });

  it("redoes cell edit after undo", async () => {
    const store = useEvaluationsV3Store.getState();

    // First change
    store.setCellValue("test-data", 0, "input", "first");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second change
    store.setCellValue("test-data", 0, "input", "second");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(getRecords()?.input?.[0]).toBe("second");

    // Undo
    useEvaluationsV3Store.temporal.getState().undo();
    expect(getRecords()?.input?.[0]).toBe("first");

    // Redo
    useEvaluationsV3Store.temporal.getState().redo();
    expect(getRecords()?.input?.[0]).toBe("second");
  });

  it("undoes deleting rows and restores data", async () => {
    const store = useEvaluationsV3Store.getState();

    // Set up some data
    store.setCellValue("test-data", 0, "input", "row0");
    store.setCellValue("test-data", 1, "input", "row1");
    store.setCellValue("test-data", 2, "input", "row2");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(getRecords()?.input?.[0]).toBe("row0");
    expect(getRecords()?.input?.[1]).toBe("row1");
    expect(getRecords()?.input?.[2]).toBe("row2");

    // Select and delete rows
    store.toggleRowSelection(0);
    store.toggleRowSelection(1);
    store.deleteSelectedRows("test-data");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should have 1 row left (row2 is now at index 0)
    expect(useEvaluationsV3Store.getState().getRowCount("test-data")).toBe(1);
    expect(getRecords()?.input?.[0]).toBe("row2");

    // Undo - rows should be restored
    useEvaluationsV3Store.temporal.getState().undo();

    expect(useEvaluationsV3Store.getState().getRowCount("test-data")).toBe(3);
    expect(getRecords()?.input?.[0]).toBe("row0");
    expect(getRecords()?.input?.[1]).toBe("row1");
  });

  it("does NOT restore editingCell on undo (prevents getting stuck in edit mode)", async () => {
    const store = useEvaluationsV3Store.getState();

    // Get the initial value for row 1 (from the sample customer support data)
    const initialRow1Value = getRecords()?.input?.[1];

    // Simulate: user double-clicks cell to edit
    store.setSelectedCell({ row: 0, columnId: "input" });
    store.setEditingCell({ row: 0, columnId: "input" });

    // User types and saves (which clears editingCell and updates value)
    store.setCellValue("test-data", 0, "input", "first edit");
    store.setEditingCell(undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // User edits another cell
    store.setSelectedCell({ row: 1, columnId: "input" });
    store.setEditingCell({ row: 1, columnId: "input" });
    store.setCellValue("test-data", 1, "input", "second edit");
    store.setEditingCell(undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify current state: not editing, value is "second edit"
    expect(useEvaluationsV3Store.getState().ui.editingCell).toBeUndefined();
    expect(getRecords()?.input?.[1]).toBe("second edit");

    // Undo using performUndo (which clears editingCell)
    performUndo();

    // Content should be undone to the initial value
    expect(getRecords()?.input?.[1]).toBe(initialRow1Value);

    // CRITICAL: editingCell should NOT be restored - user should not be in edit mode
    expect(useEvaluationsV3Store.getState().ui.editingCell).toBeUndefined();
  });

  it("does NOT restore editingCell on undo - realistic flow with edit mode active during save", async () => {
    const store = useEvaluationsV3Store.getState();

    // === First edit ===
    // User double-clicks cell 0,0 to edit
    store.setSelectedCell({ row: 0, columnId: "input" });
    store.setEditingCell({ row: 0, columnId: "input" });

    // User types - this happens WHILE editingCell is still set
    store.setCellValue("test-data", 0, "input", "first");

    // Wait for debounce - state is saved to history with editingCell still set
    await new Promise((resolve) => setTimeout(resolve, 150));

    // User presses Enter to exit edit mode
    store.setEditingCell(undefined);

    // === Second edit ===
    // User double-clicks cell 0,0 again
    store.setEditingCell({ row: 0, columnId: "input" });

    // User types
    store.setCellValue("test-data", 0, "input", "second");

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 150));

    // User presses Enter to exit edit mode
    store.setEditingCell(undefined);

    // Verify current state
    expect(useEvaluationsV3Store.getState().ui.editingCell).toBeUndefined();
    expect(getRecords()?.input?.[0]).toBe("second");

    // User presses Cmd+Z to undo - use performUndo which clears editingCell
    performUndo();

    // Value should go back to "first"
    expect(getRecords()?.input?.[0]).toBe("first");

    // CRITICAL: Even though editingCell was set when the state was saved,
    // it should NOT be restored on undo (performUndo clears it)
    expect(useEvaluationsV3Store.getState().ui.editingCell).toBeUndefined();
  });

  it("DOES restore selectedCell on undo (shows which cell was edited)", async () => {
    const store = useEvaluationsV3Store.getState();

    // Get the initial values (from the sample customer support data)
    const initialRow0Value = getRecords()?.input?.[0];
    const initialRow1Value = getRecords()?.input?.[1];

    // Edit cell at row 0
    store.setSelectedCell({ row: 0, columnId: "input" });
    store.setCellValue("test-data", 0, "input", "first");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Edit cell at row 1
    store.setSelectedCell({ row: 1, columnId: "input" });
    store.setCellValue("test-data", 1, "input", "second");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Current selection is row 1
    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 1,
      columnId: "input",
    });

    // Undo the "second" edit
    performUndo();

    // Content should be undone to initial values
    expect(getRecords()?.input?.[1]).toBe(initialRow1Value);
    expect(getRecords()?.input?.[0]).toBe("first");

    // selectedCell stays at row 1 (where the undone edit was made)
    // This is correct because we're undoing the edit, not the navigation
    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 1,
      columnId: "input",
    });

    // Undo the "first" edit
    performUndo();

    // Now selectedCell should be at row 0 (where that edit was made)
    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 0,
      columnId: "input",
    });
    // Content should be undone to initial value
    expect(getRecords()?.input?.[0]).toBe(initialRow0Value);
  });

  it("does NOT create history entries for navigation-only changes", async () => {
    const store = useEvaluationsV3Store.getState();

    // Get baseline history count
    const baselineCount =
      useEvaluationsV3Store.temporal.getState().pastStates.length;

    // User makes a content change (use unique value to avoid matching previous test state)
    const uniqueValue = `navigation-test-${Date.now()}`;
    store.setSelectedCell({ row: 0, columnId: "input" });
    store.setCellValue("test-data", 0, "input", uniqueValue);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Count history entries after content change
    const entriesAfterEdit =
      useEvaluationsV3Store.temporal.getState().pastStates.length;
    expect(entriesAfterEdit).toBeGreaterThan(baselineCount);

    // Now user navigates around WITHOUT changing any content
    store.setSelectedCell({ row: 1, columnId: "input" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    store.setSelectedCell({ row: 2, columnId: "input" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    store.setSelectedCell({ row: 0, columnId: "expected_output" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    store.setSelectedCell({ row: 1, columnId: "expected_output" });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Current selection is row 1, expected_output
    expect(useEvaluationsV3Store.getState().ui.selectedCell).toEqual({
      row: 1,
      columnId: "expected_output",
    });

    // CRITICAL: History entries should NOT have increased from navigation
    const entriesAfterNavigation =
      useEvaluationsV3Store.temporal.getState().pastStates.length;
    expect(entriesAfterNavigation).toBe(entriesAfterEdit);
  });

  it("undoes switching active dataset", async () => {
    const store = useEvaluationsV3Store.getState();
    const originalActiveId = store.activeDatasetId;

    // Add second dataset
    store.addDataset({
      id: "second-dataset",
      name: "Second Dataset",
      type: "inline",
      columns: [{ id: "col1", name: "col1", type: "string" }],
      inline: {
        columns: [{ id: "col1", name: "col1", type: "string" }],
        records: { col1: [""] },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Switch to second dataset
    store.setActiveDataset("second-dataset");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
      "second-dataset",
    );

    // Undo - should switch back
    useEvaluationsV3Store.temporal.getState().undo();

    expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
      originalActiveId,
    );
  });
});
